import type { JsonObject, JsonValue } from '#lib/domain/records';
import { copyBoundedJson } from '#lib/domain/engine/validation';
import { journalId, journalTimestamp, replayJournal } from '#lib/domain/journal';
import { rematchOrder } from '#lib/domain/rematch';
import type { LocalDatabase } from './database';
import { MatchJournal } from './journal';
import { LocalRepository } from './repository';
import { TeamRepository } from './teams';
import { requireRecord, StorageError, storageOperation, validateRecord } from './errors';

export interface RematchInput {
  sourceId: string;
  id: string;
  createdAt: string;
  expectedVersion: number;
  actorPlayerId: string;
  deviceId: string;
}

export async function createRematch(database: LocalDatabase, submission: RematchInput) {
  const input = copyBoundedJson(submission) as RematchInput;
  validateRecord(input !== null && typeof input === 'object' && !Array.isArray(input));
  validateRecord(
    [input.sourceId, input.id, input.actorPlayerId, input.deviceId].every(journalId) &&
      input.id.length <= 110 &&
      journalTimestamp(input.createdAt) &&
      Number.isSafeInteger(input.expectedVersion) &&
      input.expectedVersion >= 0,
  );
  const db = database;
  return storageOperation(() =>
    db.transaction(
      'rw',
      [
        db.games,
        db.gameVersions,
        db.variants,
        db.players,
        db.teams,
        db.teamMemberships,
        db.matches,
        db.scoreEvents,
        db.matchProjections,
        db.matchPermissions,
        db.matchAuthorities,
        db.deviceSettings,
      ],
      async () => {
        const { match, journal } = await new MatchJournal(db).inspect(input.sourceId);
        if (match.version !== input.expectedVersion) throw new StorageError('conflict');
        validateRecord(journal.projection.status === 'finished');
        const authority = journal.authority;
        const fence = await db.matchAuthorities.get(match.id);
        const localDevice = (await db.deviceSettings.get('deviceId'))?.value;
        if (
          authority.playerId !== input.actorPlayerId ||
          (authority.deviceId && authority.deviceId !== input.deviceId) ||
          ((fence || authority.deviceId) && localDevice && localDevice !== input.deviceId) ||
          (fence && (fence.state !== 'active' || fence.deviceId !== input.deviceId))
        )
          throw new StorageError('unauthorized');
        const version = requireRecord(await db.gameVersions.get(match.gameVersionId));
        validateRecord(
          version.gameId === match.rulesSnapshot.gameId &&
            version.rulesetVersion === match.rulesSnapshot.rulesetVersion &&
            version.schemaVersion === match.rulesSnapshot.schemaVersion &&
            JSON.stringify(version.definition) === JSON.stringify(match.rulesSnapshot.definition),
        );
        const order = rematchOrder(match, journal);
        const teamIds = new Map<string, string>();
        for (const [index, snapshot] of match.teamsSnapshot.entries()) {
          if (!order.includes(snapshot.id)) continue;
          const current = await db.teams.get(snapshot.id);
          const members = await db.teamMemberships
            .where('teamId')
            .equals(snapshot.id)
            .filter((member) => !member.leftAt)
            .toArray();
          const memberOrder =
            current?.memberOrder ?? members.map((member) => member.playerId).sort();
          if (
            current &&
            !current.deletedAt &&
            !current.archivedAt &&
            current.name === snapshot.name &&
            current.color === snapshot.color &&
            (current.format ?? 'free') === (snapshot.format ?? 'free') &&
            (current.avatar ?? 'initials') === (snapshot.avatar ?? 'initials') &&
            JSON.stringify(memberOrder) === JSON.stringify(snapshot.playerIds)
          ) {
            teamIds.set(snapshot.id, snapshot.id);
          } else {
            const id = `${input.id}-team-${index}`;
            await new TeamRepository(db).saveTeam(
              {
                id,
                name: snapshot.name,
                color: snapshot.color,
                avatar: snapshot.avatar,
                format: snapshot.format ?? 'free',
                createdAt: input.createdAt,
                updatedAt: input.createdAt,
              },
              snapshot.playerIds,
              { create: true },
            );
            teamIds.set(snapshot.id, id);
          }
        }
        const owners = order.map((id) => teamIds.get(id) ?? id);
        const settings: Record<string, JsonValue> = {
          ...(copyBoundedJson(match.settingsSnapshot) as JsonObject),
        };
        // A rematch starts with the loser; the previous cork is historical evidence only.
        delete settings.dartsCorkWinnerId;
        if (match.rulesSnapshot.gameId === 'petanque') settings.firstThrowOwnerId = owners[0]!;
        else settings.engineConfig = { mode: match.mode, ownerIds: owners };
        if (
          settings.dartsMatch &&
          typeof settings.dartsMatch === 'object' &&
          !Array.isArray(settings.dartsMatch)
        )
          settings.dartsMatch = { ...settings.dartsMatch, firstStarterId: owners[0]! };
        const players = order.flatMap(
          (id) => match.teamsSnapshot.find((team) => team.id === id)?.playerIds ?? [id],
        );
        const created = await new LocalRepository(db).createMatch({
          id: input.id,
          gameVersionId: match.gameVersionId,
          mode: match.mode,
          playerIds: players,
          teamIds: order.filter((id) => teamIds.has(id)).map((id) => teamIds.get(id)!),
          organizerPlayerId: authority.playerId,
          settings,
          createdAt: input.createdAt,
        });
        await db.matchProjections.put(replayJournal(created, []).projection);
        await new MatchJournal(db).submit({
          matchId: created.id,
          eventId: `${input.id}-start`,
          commandId: `${input.id}-start`,
          expectedVersion: 0,
          actorPlayerId: authority.playerId,
          deviceId: input.deviceId,
          timestamp: input.createdAt,
          action: { type: 'start' },
        });
        return requireRecord(await db.matches.get(created.id));
      },
    ),
  );
}
