import { matchesHistory, type HistoryFilters, type HistoryCursor } from '#lib/domain/history';
import type { JsonObject, ScoreEventRecord, MatchPermissionRecord } from '#lib/domain/records';
import {
  MAX_JOURNAL_EVENTS,
  JournalError,
  journalId,
  journalTimestamp,
  parseJournalAction,
  replayJournal,
  validatePeerAttribution,
  type PeerAttribution,
} from '#lib/domain/journal';
import type { LocalDatabase } from './database';
import { copyBoundedJson } from '#lib/domain/engine/validation';
import { requireRecord, StorageError, storageOperation, validateRecord } from './errors';

export interface JournalSubmission {
  readonly matchId: string;
  readonly eventId: string;
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly actorPlayerId: string;
  readonly deviceId: string;
  readonly timestamp: string;
  readonly action: unknown;
}

// The organizer's authoritative local path. Peer/import payloads need a separate protocol boundary.
export class MatchJournal {
  constructor(private readonly database: LocalDatabase) {}

  private async events(matchId: string): Promise<ScoreEventRecord[]> {
    const events = await this.database.scoreEvents
      .where('[matchId+sequence]')
      .between([matchId, 0], [matchId, Infinity])
      .limit(MAX_JOURNAL_EVENTS + 1)
      .toArray();
    if (events.length > MAX_JOURNAL_EVENTS) throw new JournalError('history_limit');
    return events;
  }

  async submit(submission: JournalSubmission) {
    return this.commit(submission);
  }

  async deleteMatch(input: {
    matchId: string;
    expectedVersion: number;
    actorPlayerId: string;
    deviceId: string;
  }): Promise<void> {
    const data = copyBoundedJson(input) as typeof input;
    validateRecord(
      [data.matchId, data.actorPlayerId, data.deviceId].every(journalId) &&
        Number.isSafeInteger(data.expectedVersion) &&
        data.expectedVersion >= 0,
    );
    const db = this.database;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [
          db.matches,
          db.rounds,
          db.scoreEvents,
          db.matchProjections,
          db.matchPermissions,
          db.matchAuthorities,
          db.peerReplicas,
          db.deviceSettings,
        ],
        async () => {
          const match = requireRecord(await db.matches.get(data.matchId));
          const authority = replayJournal(match, await this.events(match.id)).authority;
          const fence = await db.matchAuthorities.get(match.id);
          const localDevice = (await db.deviceSettings.get('deviceId'))?.value;
          if (
            authority.playerId !== data.actorPlayerId ||
            (authority.deviceId && authority.deviceId !== data.deviceId) ||
            ((fence || authority.deviceId) && localDevice && localDevice !== data.deviceId) ||
            (fence && (fence.state !== 'active' || fence.deviceId !== data.deviceId))
          )
            throw new StorageError('unauthorized');
          if (match.version !== data.expectedVersion) throw new StorageError('conflict');
          await db.rounds.where('matchId').equals(match.id).delete();
          await db.scoreEvents
            .where('[matchId+sequence]')
            .between([match.id, 0], [match.id, Infinity])
            .delete();
          await db.matchPermissions.where('matchId').equals(match.id).delete();
          await db.peerReplicas.where('matchId').equals(match.id).delete();
          await db.matchProjections.delete(match.id);
          await db.matchAuthorities.delete(match.id);
          await db.matches.delete(match.id);
        },
      ),
    );
  }
  async setPeerPermission(input: {
    matchId: string;
    organizerPlayerId: string;
    playerId: string;
    sessionId: string;
    role: 'viewer' | 'scorer' | 'manager';
    expectedRevision: number;
    deviceId?: string;
  }) {
    const data = copyBoundedJson(input) as typeof input;
    validateRecord(
      [data.matchId, data.organizerPlayerId, data.playerId, data.sessionId].every(journalId) &&
        ['viewer', 'scorer', 'manager'].includes(data.role) &&
        Number.isSafeInteger(data.expectedRevision) &&
        data.expectedRevision >= 0,
    );
    const db = this.database;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [db.matches, db.matchPermissions, db.scoreEvents, db.matchAuthorities, db.deviceSettings],
        async () => {
          const match = requireRecord(await db.matches.get(data.matchId));
          const current = replayJournal(match, await this.events(match.id)).authority;
          const fence = await db.matchAuthorities.get(match.id);
          const localDevice = (await db.deviceSettings.get('deviceId'))?.value;
          if ((fence || current.deviceId) && localDevice && localDevice !== data.deviceId)
            throw new StorageError('unauthorized');
          if (
            (current.deviceId && current.deviceId !== data.deviceId) ||
            (fence && (fence.state !== 'active' || fence.deviceId !== data.deviceId))
          )
            throw new StorageError('unauthorized');
          if (
            data.organizerPlayerId !== current.playerId ||
            data.playerId === current.playerId ||
            !match.playersSnapshot.some((p) => p.id === data.playerId)
          )
            throw new StorageError('unauthorized');
          const previous = await db.matchPermissions.get([data.matchId, data.playerId]);
          if ((previous?.revision ?? 0) !== data.expectedRevision)
            throw new StorageError('conflict');
          const permission: MatchPermissionRecord = {
            matchId: data.matchId,
            playerId: data.playerId,
            role: data.role,
            sessionId: data.sessionId,
            grantedBy: current.playerId,
            revision: data.expectedRevision + 1,
          };
          await db.matchPermissions.put(permission);
          return permission;
        },
      ),
    );
  }
  // Identity is bound by the organizer to the channel; it never comes from the peer's command.
  async submitPeer(
    submission: JournalSubmission,
    binding: { playerId: string; sessionId: string; permissionRevision: number },
  ) {
    return this.commit(submission, copyBoundedJson(binding) as typeof binding);
  }
  private async commit(
    submission: JournalSubmission,
    binding?: { playerId: string; sessionId: string; permissionRevision: number },
  ) {
    const input = copyBoundedJson(submission) as JournalSubmission;
    validateRecord(input !== null && typeof input === 'object');
    validateRecord(
      [input.matchId, input.eventId, input.commandId, input.actorPlayerId, input.deviceId].every(
        journalId,
      ) &&
        journalTimestamp(input.timestamp) &&
        Number.isSafeInteger(input.expectedVersion) &&
        input.expectedVersion >= 0,
    );
    const action = parseJournalAction(input.action);
    const db = this.database;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [
          db.matches,
          db.scoreEvents,
          db.matchProjections,
          db.matchPermissions,
          db.matchAuthorities,
          db.deviceSettings,
        ],
        async () => {
          const match = requireRecord(await db.matches.get(input.matchId));
          const currentView = replayJournal(match, await this.events(match.id));
          const authority = currentView.authority;
          const fence = await db.matchAuthorities.get(match.id);
          const localDevice = (await db.deviceSettings.get('deviceId'))?.value;
          if ((fence || authority.deviceId) && localDevice && localDevice !== input.deviceId)
            throw new StorageError('unauthorized');
          if (
            authority.playerId !== input.actorPlayerId ||
            (authority.deviceId && authority.deviceId !== input.deviceId) ||
            (fence &&
              (fence.deviceId !== input.deviceId || fence.state !== 'active') &&
              action.type !== 'authority_transfer')
          )
            throw new StorageError('unauthorized');
          if (
            action.type === 'authority_transfer' &&
            (!fence ||
              fence.state !== 'prepared' ||
              fence.deviceId !== input.deviceId ||
              fence.transferId !== action.transferId ||
              fence.targetPlayerId !== action.playerId ||
              fence.targetDeviceId !== action.deviceId ||
              fence.baseVersion !== input.expectedVersion)
          )
            throw new StorageError('unauthorized');
          let proposal: PeerAttribution | undefined;
          if (binding) {
            const permission = await db.matchPermissions.get([match.id, binding.playerId]);
            if (
              !permission ||
              permission.grantedBy !== authority.playerId ||
              permission.sessionId !== binding.sessionId ||
              permission.revision !== binding.permissionRevision ||
              (permission.role !== 'manager' && permission.role !== 'scorer')
            )
              throw new StorageError('unauthorized');
            try {
              proposal = validatePeerAttribution(
                match,
                action,
                {
                  ...binding,
                  role: permission.role,
                },
                authority.playerId,
              );
            } catch {
              throw new StorageError('unauthorized');
            }
            const duplicate = await db.scoreEvents
              .where('[matchId+commandId]')
              .equals([match.id, input.commandId])
              .first();
            if (duplicate) {
              if (
                JSON.stringify(duplicate.payload.action) !== JSON.stringify(action) ||
                JSON.stringify(duplicate.payload.proposal) !== JSON.stringify(proposal)
              )
                throw new StorageError('conflict');
              return replayJournal(match, await this.events(match.id));
            }
          }
          if (match.version !== input.expectedVersion) throw new StorageError('conflict');
          if (
            await db.scoreEvents
              .where('[matchId+commandId]')
              .equals([match.id, input.commandId])
              .count()
          )
            throw new StorageError('conflict');
          const event: ScoreEventRecord = {
            id: input.eventId,
            matchId: match.id,
            commandId: input.commandId,
            sequence: match.version + 1,
            actorPlayerId: input.actorPlayerId,
            deviceId: input.deviceId,
            timestamp: input.timestamp,
            payload: {
              journalVersion: 1,
              action,
              ...(proposal ? { proposal } : {}),
            } as unknown as JsonObject,
            ...(action.type === 'correct' || action.type === 'undo'
              ? { supersedesId: action.targetEventId }
              : {}),
          };
          const view = replayJournal({ ...match, version: event.sequence }, [
            ...(await this.events(match.id)),
            event,
          ]);
          if (action.type === 'authority_transfer')
            await db.matchAuthorities.put({
              matchId: match.id,
              playerId: action.playerId,
              deviceId: action.deviceId,
              epoch: action.epoch,
              state: 'released',
              transferId: action.transferId,
            });
          if (action.type === 'authority_transfer') {
            for (const permission of await db.matchPermissions
              .where('matchId')
              .equals(match.id)
              .toArray())
              await db.matchPermissions.put({
                matchId: match.id,
                playerId: permission.playerId,
                role: 'viewer',
                grantedBy: action.playerId,
                revision: permission.revision + 1,
              });
            await db.matchPermissions.put({
              matchId: match.id,
              playerId: action.playerId,
              role: 'organizer',
              grantedBy: action.playerId,
              revision: 1,
            });
          }
          await db.scoreEvents.add(event);
          await db.matchProjections.put(view.projection);
          await db.matches.put({
            ...match,
            version: event.sequence,
            status: view.projection.status,
            updatedAt: input.timestamp,
          });
          return view;
        },
      ),
    );
  }

  async read(matchId: string) {
    return (await this.inspect(matchId)).journal;
  }

  async inspect(matchId: string) {
    const db = this.database;
    return storageOperation(() =>
      db.transaction('r', [db.matches, db.scoreEvents, db.matchAuthorities], async () => {
        const match = requireRecord(await db.matches.get(matchId));
        return {
          match,
          journal: replayJournal(match, await this.events(matchId)),
          authorityLock: await db.matchAuthorities.get(matchId),
        };
      }),
    );
  }

  async list(page = 0) {
    validateRecord(Number.isSafeInteger(page) && page >= 0);
    return storageOperation(async () => {
      const rows = await this.database.matches
        .orderBy('createdAt')
        .reverse()
        .offset(page * 24)
        .limit(25)
        .toArray();
      return { items: rows.slice(0, 24), hasMore: rows.length > 24 };
    });
  }

  async history(filters: HistoryFilters = {}, after?: HistoryCursor) {
    validateRecord(
      [filters.search, filters.game, filters.player, filters.team, filters.variant].every(
        (value) => value === undefined || (typeof value === 'string' && value.length <= 120),
      ) &&
        (!filters.status ||
          ['draft', 'in_progress', 'paused', 'finished', 'cancelled'].includes(filters.status)) &&
        (!filters.from || journalTimestamp(filters.from)) &&
        (!filters.until || journalTimestamp(filters.until)) &&
        (!filters.from || !filters.until || filters.from < filters.until) &&
        (!after || (journalTimestamp(after.createdAt) && journalId(after.id))),
    );
    return storageOperation(async () => {
      const rows = await this.database.matches
        .where('createdAt')
        .between(filters.from ?? '', filters.until ?? '\uffff', true, false)
        .reverse()
        .filter(
          (match) =>
            !after ||
            match.createdAt < after.createdAt ||
            (match.createdAt === after.createdAt && match.id < after.id),
        )
        .limit(121)
        .toArray();
      const items = [];
      let processed = 0;
      let nextCursor: HistoryCursor | undefined;
      for (const match of rows.slice(0, 120)) {
        processed++;
        nextCursor = { createdAt: match.createdAt, id: match.id };
        if (matchesHistory(match, filters)) items.push(match);
        if (items.length === 24) break;
      }
      return { items, hasMore: processed < rows.length, nextCursor };
    });
  }

  async exportMatch(matchId: string) {
    const value = await this.inspect(matchId);
    return JSON.stringify(
      {
        format: 'scoretrackrr-match',
        formatVersion: 1,
        match: value.match,
        events: value.journal.audit.map((entry) => entry.event),
      },
      null,
      2,
    );
  }

  async rebuild(matchId: string, expectedVersion: number) {
    const db = this.database;
    return storageOperation(() =>
      db.transaction('rw', [db.matches, db.scoreEvents, db.matchProjections], async () => {
        const match = requireRecord(await db.matches.get(matchId));
        if (match.version !== expectedVersion) throw new StorageError('conflict');
        const view = replayJournal(match, await this.events(matchId));
        await db.matchProjections.put(view.projection);
        await db.matches.put({ ...match, status: view.projection.status });
        return view;
      }),
    );
  }
}
