import type { LocalDatabase } from './database';
import { LocalRepository } from './repository';
import { TeamRepository } from './teams';
import { MatchJournal } from './journal';
import { assertPetanqueMatch, petanqueVersion } from '#lib/domain/games/petanque';
import { copyBoundedJson } from '#lib/domain/engine/validation';
import { replayJournal } from '#lib/domain/journal';
import { requireRecord, StorageError, storageOperation, validateRecord } from './errors';

export interface CreatePetanqueInput {
  readonly id: string;
  readonly mode: 'individual' | 'teams';
  readonly playerIds: readonly string[];
  readonly boulesPerPlayer: 2 | 3;
  readonly teams: readonly { readonly id: string; readonly revision: number }[];
  readonly organizerPlayerId: string;
  readonly firstThrowOwnerId: string;
  readonly target: 11 | 13;
  readonly createdAt: string;
}

export class PetanqueRepository {
  constructor(private readonly db: LocalDatabase) {}

  async create(submission: CreatePetanqueInput) {
    const input = copyBoundedJson(submission) as CreatePetanqueInput;
    validateRecord(
      (input.target === 11 || input.target === 13) &&
        (input.boulesPerPlayer === 2 || input.boulesPerPlayer === 3) &&
        ((input.mode === 'teams' &&
          input.playerIds.length === 0 &&
          input.teams.length >= 2 &&
          input.teams.length <= 16 &&
          new Set(input.teams.map((team) => team.id)).size === input.teams.length) ||
          (input.mode === 'individual' &&
            input.teams.length === 0 &&
            input.playerIds.length >= 2 &&
            input.playerIds.length <= 16)),
    );
    const db = this.db;
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
          db.matchProjections,
          db.matchPermissions,
          db.matchAuthorities,
        ],
        async () => {
          const playerIds: string[] = [...input.playerIds];
          for (const reference of input.teams) {
            const team = requireRecord(await db.teams.get(reference.id));
            if ((team.revision ?? 0) !== reference.revision || team.archivedAt || team.deletedAt)
              throw new StorageError('conflict');
            const members = await db.teamMemberships
              .where('teamId')
              .equals(reference.id)
              .filter((member) => !member.leftAt)
              .toArray();
            validateRecord(members.length >= 1 && members.length <= 32);
            const memberIds = members.map((member) => member.playerId);
            const order = team.memberOrder ?? [...memberIds].sort();
            validateRecord(
              order.length === memberIds.length &&
                new Set(order).size === memberIds.length &&
                order.every((id) => memberIds.includes(id)),
            );
            playerIds.push(...order);
          }
          validateRecord(playerIds.length <= 256 && new Set(playerIds).size === playerIds.length);
          const version = petanqueVersion(input.target, input.createdAt, input.mode);
          const current = await db.gameVersions.get(version.id);
          if (
            current &&
            (current.gameId !== version.gameId ||
              current.rulesetVersion !== version.rulesetVersion ||
              current.schemaVersion !== 1 ||
              JSON.stringify(current.definition) !== JSON.stringify(version.definition))
          )
            throw new StorageError('conflict');
          const game = await db.games.get('petanque');
          if (!game)
            await db.games.add({
              id: 'petanque',
              slug: 'petanque',
              name: 'Pétanque',
              state: 'available',
            });
          if (!current) await db.gameVersions.add(version);
          const match = await new LocalRepository(db).createMatch({
            id: input.id,
            gameVersionId: version.id,
            playerIds,
            teamIds: input.teams.map((team) => team.id),
            organizerPlayerId: input.organizerPlayerId,
            mode: input.mode,
            settings: {
              target: input.target,
              firstThrowOwnerId: input.firstThrowOwnerId,
              boulesPerPlayer: input.boulesPerPlayer,
            },
            createdAt: input.createdAt,
          });
          assertPetanqueMatch(match);
          await db.matchProjections.put(replayJournal(match, []).projection);
          return match;
        },
      ),
    );
  }

  async rematch(
    sourceId: string,
    input: { id: string; createdAt: string; expectedVersion: number },
  ) {
    const db = this.db;
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
        ],
        async () => {
          const { match, journal } = await new MatchJournal(db).inspect(sourceId);
          assertPetanqueMatch(match);
          if (match.version !== input.expectedVersion) throw new StorageError('conflict');
          validateRecord(
            journal.projection.status === 'finished' || journal.projection.status === 'cancelled',
          );
          // Reuse unchanged teams; preserve the reviewed lineup when a profile has since changed.
          const teams = [];
          for (let index = 0; index < match.teamsSnapshot.length; index++) {
            const snapshot = match.teamsSnapshot[index]!;
            const current = await db.teams.get(snapshot.id);
            const members = await db.teamMemberships
              .where('teamId')
              .equals(snapshot.id)
              .filter((member) => !member.leftAt)
              .toArray();
            const order = current?.memberOrder ?? members.map((member) => member.playerId).sort();
            if (
              current &&
              !current.archivedAt &&
              !current.deletedAt &&
              current.name === snapshot.name &&
              current.color === snapshot.color &&
              (current.avatar ?? 'initials') === (snapshot.avatar ?? 'initials') &&
              JSON.stringify(order) === JSON.stringify(snapshot.playerIds)
            ) {
              teams.push({ id: current.id, revision: current.revision ?? 0 });
              continue;
            }
            const id = `${input.id}-team-${index}`;
            await new TeamRepository(db).saveTeam(
              {
                id,
                name: snapshot.name,
                color: snapshot.color,
                avatar: snapshot.avatar,
                kind: 'permanent',
                format: snapshot.format ?? 'free',
                createdAt: input.createdAt,
                updatedAt: input.createdAt,
              },
              snapshot.playerIds,
              { create: true },
            );
            teams.push({ id, revision: 1 });
          }
          const firstIndex = match.teamsSnapshot.findIndex(
            (team) => team.id === match.settingsSnapshot.firstThrowOwnerId,
          );
          return this.create({
            ...input,
            teams,
            organizerPlayerId: journal.authority.playerId,
            target: match.settingsSnapshot.target as 11 | 13,
            firstThrowOwnerId:
              match.mode === 'teams'
                ? teams[firstIndex]!.id
                : (match.settingsSnapshot.firstThrowOwnerId as string),
            mode: match.mode as 'individual' | 'teams',
            playerIds:
              match.mode === 'individual' ? match.playersSnapshot.map((player) => player.id) : [],
            boulesPerPlayer: match.settingsSnapshot.boulesPerPlayer as 2 | 3,
          });
        },
      ),
    );
  }
}
