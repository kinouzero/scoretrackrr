import type { LocalDatabase } from './database';
import type {
  MatchAuthorityRecord,
  PeerReplicaRecord,
  PlayerRecord,
  MatchRecord,
} from '#lib/domain/records';
import { decodePeerJournal, encodePeerJournal } from '#lib/domain/peer-journal';
import {
  journalId,
  journalTimestamp,
  replayJournal,
  MAX_JOURNAL_EVENTS,
} from '#lib/domain/journal';
import { validatePeerUpdate } from '#lib/domain/peer-view';
import { CatalogRepository } from './catalog';
import { MatchJournal } from './journal';
import { StorageError, storageOperation, validateRecord, requireRecord } from './errors';

function matchIdentity(match: MatchRecord) {
  return JSON.stringify({
    id: match.id,
    gameVersionId: match.gameVersionId,
    organizerPlayerId: match.organizerPlayerId,
    createdAt: match.createdAt,
    mode: match.mode,
    rules: match.rulesSnapshot,
    settings: match.settingsSnapshot,
    players: match.playersSnapshot.map(({ id, displayName, color, isGuest }) => ({
      id,
      displayName,
      color,
      isGuest,
    })),
    teams: match.teamsSnapshot.map(({ id, name, color, playerIds }) => ({
      id,
      name,
      color,
      playerIds,
    })),
  });
}

// A prepared source is fenced before an offer is sent. Release is irreversible on that device.
export class AuthorityRepository {
  constructor(private readonly db: LocalDatabase) {}
  async prepare(input: {
    matchId: string;
    playerId: string;
    deviceId: string;
    targetPlayerId: string;
    targetSessionId: string;
    transferId: string;
    expectedVersion: number;
  }) {
    validateRecord(
      [
        input.matchId,
        input.playerId,
        input.deviceId,
        input.targetPlayerId,
        input.targetSessionId,
        input.transferId,
      ].every(journalId),
    );
    if ((await this.db.readOrCreateDeviceId(input.deviceId)) !== input.deviceId)
      throw new StorageError('unauthorized');
    const db = this.db;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [db.matches, db.scoreEvents, db.matchAuthorities, db.matchPermissions],
        async () => {
          const { match, journal, authorityLock } = await new MatchJournal(db).inspect(
            input.matchId,
          );
          if (
            journal.authority.playerId !== input.playerId ||
            (journal.authority.deviceId && journal.authority.deviceId !== input.deviceId) ||
            (authorityLock &&
              (authorityLock.state !== 'active' || authorityLock.deviceId !== input.deviceId))
          )
            throw new StorageError('unauthorized');
          if (
            match.version !== input.expectedVersion ||
            !['draft', 'in_progress', 'paused'].includes(match.status)
          )
            throw new StorageError('conflict');
          validateRecord(
            input.targetPlayerId !== input.playerId &&
              match.playersSnapshot.some((p) => p.id === input.targetPlayerId),
          );
          const permission = await db.matchPermissions.get([match.id, input.targetPlayerId]);
          if (
            !permission ||
            permission.role !== 'manager' ||
            permission.sessionId !== input.targetSessionId ||
            permission.grantedBy !== input.playerId
          )
            throw new StorageError('unauthorized');
          const lock: MatchAuthorityRecord = {
            matchId: match.id,
            playerId: input.playerId,
            deviceId: input.deviceId,
            epoch: journal.authority.epoch,
            state: 'prepared',
            transferId: input.transferId,
            targetPlayerId: input.targetPlayerId,
            targetSessionId: input.targetSessionId,
            baseVersion: match.version,
          };
          await db.matchAuthorities.put(lock);
          return lock;
        },
      ),
    );
  }
  async ready(input: {
    matchId: string;
    transferId: string;
    sessionId: string;
    targetDeviceId: string;
  }) {
    validateRecord(
      [input.matchId, input.transferId, input.sessionId, input.targetDeviceId].every(journalId),
    );
    const db = this.db;
    return storageOperation(() =>
      db.transaction('rw', db.matchAuthorities, async () => {
        const lock = requireRecord(await db.matchAuthorities.get(input.matchId));
        if (
          lock.state !== 'prepared' ||
          lock.transferId !== input.transferId ||
          lock.targetSessionId !== input.sessionId ||
          lock.deviceId === input.targetDeviceId ||
          (lock.targetDeviceId && lock.targetDeviceId !== input.targetDeviceId)
        )
          throw new StorageError('unauthorized');
        await db.matchAuthorities.put({ ...lock, targetDeviceId: input.targetDeviceId });
      }),
    );
  }
  async cancel(matchId: string, transferId: string, deviceId: string) {
    if ((await this.db.readOrCreateDeviceId(deviceId)) !== deviceId)
      throw new StorageError('unauthorized');
    const db = this.db;
    return storageOperation(() =>
      db.transaction('rw', db.matchAuthorities, async () => {
        const lock = requireRecord(await db.matchAuthorities.get(matchId));
        if (
          lock.state !== 'prepared' ||
          lock.transferId !== transferId ||
          lock.deviceId !== deviceId
        )
          throw new StorageError('unauthorized');
        if (lock.epoch === 0) await db.matchAuthorities.delete(matchId);
        else
          await db.matchAuthorities.put({
            matchId,
            playerId: lock.playerId,
            deviceId,
            epoch: lock.epoch,
            state: 'active',
          });
      }),
    );
  }
  async commit(matchId: string, transferId: string, deviceId: string, timestamp: string) {
    if ((await this.db.readOrCreateDeviceId(deviceId)) !== deviceId)
      throw new StorageError('unauthorized');
    const lock = requireRecord(await this.db.matchAuthorities.get(matchId));
    if (
      lock.state !== 'prepared' ||
      lock.transferId !== transferId ||
      lock.deviceId !== deviceId ||
      !lock.targetDeviceId ||
      !lock.targetPlayerId ||
      lock.baseVersion === undefined
    )
      throw new StorageError('unauthorized');
    return new MatchJournal(this.db).submit({
      matchId,
      eventId: transferId,
      commandId: transferId,
      expectedVersion: lock.baseVersion,
      actorPlayerId: lock.playerId,
      deviceId,
      timestamp,
      action: {
        type: 'authority_transfer',
        playerId: lock.targetPlayerId,
        deviceId: lock.targetDeviceId,
        transferId,
        epoch: lock.epoch + 1,
      },
    });
  }
  async stage(
    transferId: string,
    text: string,
    deviceId: string,
    acceptedAt: string,
    expectedVersion: number,
    targetPlayerId: string,
  ) {
    validateRecord(journalId(transferId) && journalId(deviceId) && journalTimestamp(acceptedAt));
    if ((await this.db.readOrCreateDeviceId(deviceId)) !== deviceId)
      throw new StorageError('unauthorized');
    const recovered = decodePeerJournal(text);
    if (
      recovered.match.version !== expectedVersion ||
      !recovered.match.playersSnapshot.some((p) => p.id === targetPlayerId) ||
      targetPlayerId === recovered.journal.authority.playerId
    )
      throw new StorageError('conflict');
    const replica: PeerReplicaRecord = {
      id: transferId,
      matchId: recovered.match.id,
      deviceId,
      baseVersion: expectedVersion,
      acceptedAt,
      targetPlayerId,
      text,
    };
    const db = this.db;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [db.peerReplicas, db.matches, db.scoreEvents, db.gameVersions, db.games],
        async () => {
          const existing = await db.peerReplicas.get(transferId);
          if (existing && JSON.stringify({ ...existing, acceptedAt }) !== JSON.stringify(replica))
            throw new StorageError('conflict');
          const version = await db.gameVersions.get(recovered.match.gameVersionId);
          if (
            version &&
            (version.gameId !== recovered.match.rulesSnapshot.gameId ||
              version.rulesetVersion !== recovered.match.rulesSnapshot.rulesetVersion ||
              JSON.stringify(version.definition) !==
                JSON.stringify(recovered.match.rulesSnapshot.definition))
          )
            throw new StorageError('conflict');
          const slug = await db.games
            .where('slug')
            .equals(recovered.match.rulesSnapshot.gameId)
            .first();
          if (slug && slug.id !== recovered.match.rulesSnapshot.gameId)
            throw new StorageError('conflict');
          const known = await db.scoreEvents
            .where('[matchId+sequence]')
            .between([recovered.match.id, 0], [recovered.match.id, Infinity])
            .limit(MAX_JOURNAL_EVENTS + 1)
            .toArray();
          if (
            known.length > recovered.events.length ||
            JSON.stringify(known) !== JSON.stringify(recovered.events.slice(0, known.length))
          )
            throw new StorageError('conflict');
          const collisions = await db.scoreEvents.bulkGet(
            recovered.events.map((event) => event.id),
          );
          if (
            collisions.some(
              (event, index) =>
                event && JSON.stringify(event) !== JSON.stringify(recovered.events[index]),
            )
          )
            throw new StorageError('conflict');
          const knownMatch = await db.matches.get(recovered.match.id);
          if (knownMatch) {
            if (matchIdentity(knownMatch) !== matchIdentity(recovered.match))
              throw new StorageError('conflict');
            const projection = replayJournal(
              { ...knownMatch, version: recovered.match.version },
              recovered.events,
            ).projection;
            if (
              JSON.stringify(
                decodePeerJournal(
                  encodePeerJournal(
                    { ...knownMatch, version: recovered.match.version, status: projection.status },
                    recovered.events,
                  ),
                ).view,
              ) !== JSON.stringify(recovered.view)
            )
              throw new StorageError('conflict');
          }
          if (!existing) await db.peerReplicas.add(replica);
          return replica;
        },
      ),
    );
  }
  async activate(text: string, deviceId: string) {
    if ((await this.db.readOrCreateDeviceId(deviceId)) !== deviceId)
      throw new StorageError('unauthorized');
    const incoming = decodePeerJournal(text),
      authority = incoming.journal.authority;
    if (!authority.transferId || authority.deviceId !== deviceId)
      throw new StorageError('unauthorized');
    const db = this.db;
    await new CatalogRepository(db).initialize(incoming.match.updatedAt);
    return storageOperation(() =>
      db.transaction(
        'rw',
        [
          db.peerReplicas,
          db.matchAuthorities,
          db.matches,
          db.scoreEvents,
          db.matchProjections,
          db.players,
          db.teams,
          db.teamMemberships,
          db.games,
          db.gameVersions,
          db.matchPermissions,
        ],
        async () => {
          const stage = requireRecord(await db.peerReplicas.get(authority.transferId!));
          if (
            stage.deviceId !== deviceId ||
            stage.targetPlayerId !== authority.playerId ||
            stage.matchId !== incoming.match.id ||
            incoming.events.length <= stage.baseVersion
          )
            throw new StorageError('unauthorized');
          const base = decodePeerJournal(stage.text);
          validatePeerUpdate(base.view, incoming.view);
          if (matchIdentity(base.match) !== matchIdentity(incoming.match))
            throw new StorageError('conflict');
          if (
            JSON.stringify(base.events) !==
            JSON.stringify(incoming.events.slice(0, stage.baseVersion))
          )
            throw new StorageError('conflict');
          const knownMatch = await db.matches.get(incoming.match.id);
          if (knownMatch && matchIdentity(knownMatch) !== matchIdentity(incoming.match))
            throw new StorageError('conflict');
          const knownEvents = knownMatch
            ? await db.scoreEvents
                .where('[matchId+sequence]')
                .between([knownMatch.id, 0], [knownMatch.id, Infinity])
                .limit(MAX_JOURNAL_EVENTS + 1)
                .toArray()
            : [];
          if (knownMatch && knownEvents.length >= incoming.events.length) {
            const current = replayJournal(knownMatch, knownEvents);
            if (
              current.authority.transferId === authority.transferId &&
              current.authority.deviceId === deviceId &&
              JSON.stringify(knownEvents.slice(0, incoming.events.length)) ===
                JSON.stringify(incoming.events)
            )
              return knownMatch.id;
            throw new StorageError('conflict');
          }
          if (
            JSON.stringify(knownEvents) !==
            JSON.stringify(incoming.events.slice(0, knownEvents.length))
          )
            throw new StorageError('conflict');
          const match = knownMatch
            ? {
                ...knownMatch,
                version: incoming.match.version,
                status: incoming.match.status,
                updatedAt: incoming.match.updatedAt,
              }
            : incoming.match;
          // Existing snapshots keep their cached appearance; every incoming event still has to replay against them.
          const replayed = decodePeerJournal(encodePeerJournal(match, incoming.events));
          if (JSON.stringify(replayed.view) !== JSON.stringify(incoming.view))
            throw new StorageError('conflict');
          const version = await db.gameVersions.get(match.gameVersionId);
          if (
            version &&
            (version.gameId !== match.rulesSnapshot.gameId ||
              version.rulesetVersion !== match.rulesSnapshot.rulesetVersion ||
              JSON.stringify(version.definition) !== JSON.stringify(match.rulesSnapshot.definition))
          )
            throw new StorageError('conflict');
          if (!version) await db.gameVersions.add(match.rulesSnapshot);
          if (!(await db.games.get(match.rulesSnapshot.gameId)))
            await db.games.add({
              id: match.rulesSnapshot.gameId,
              slug: match.rulesSnapshot.gameId,
              name: match.rulesSnapshot.name ?? match.rulesSnapshot.gameId,
              state: 'available',
              origin: 'custom',
              currentVersionId: match.gameVersionId,
            });
          for (const player of match.playersSnapshot)
            if (!(await db.players.get(player.id))) {
              const record: PlayerRecord = {
                id: player.id,
                displayName: player.displayName,
                color: player.color,
                isGuest: true,
                createdAt: match.createdAt,
                updatedAt: match.updatedAt,
              };
              await db.players.add(record);
            }
          for (const team of match.teamsSnapshot)
            if (!(await db.teams.get(team.id))) {
              await db.teams.add({
                id: team.id,
                name: team.name,
                color: team.color,
                kind: 'permanent',
                memberOrder: [...team.playerIds],
                createdAt: match.createdAt,
                updatedAt: match.updatedAt,
              });
              for (const [index, playerId] of team.playerIds.entries())
                await db.teamMemberships.add({
                  id: `${authority.transferId}-${match.teamsSnapshot.indexOf(team)}-${index}`,
                  teamId: team.id,
                  playerId,
                  joinedAt: match.createdAt,
                });
            }
          for (const event of incoming.events.slice(knownEvents.length))
            await db.scoreEvents.add(event);
          await db.matches.put(match);
          await db.matchProjections.put(replayed.journal.projection);
          for (const permission of await db.matchPermissions
            .where('matchId')
            .equals(match.id)
            .toArray())
            await db.matchPermissions.put({
              ...permission,
              role: 'viewer',
              sessionId: undefined,
              grantedBy: authority.playerId,
              revision: permission.revision + 1,
            });
          await db.matchPermissions.put({
            matchId: match.id,
            playerId: authority.playerId,
            role: 'organizer',
            grantedBy: authority.playerId,
            revision: 1,
          });
          await db.matchAuthorities.put({
            matchId: match.id,
            playerId: authority.playerId,
            deviceId,
            epoch: authority.epoch,
            state: 'active',
            transferId: authority.transferId,
          });
          return match.id;
        },
      ),
    );
  }
}
