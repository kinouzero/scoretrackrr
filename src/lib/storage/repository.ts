import type {
  GameRecord,
  GameVersionRecord,
  JsonObject,
  MatchMode,
  MatchProjectionRecord,
  MatchRecord,
  PlayerRecord,
  RoundRecord,
  ScoreEventRecord,
  TeamRecord,
  VariantRecord,
} from '#lib/domain/records';
import type { LocalDatabase } from './database';
import {
  normalizePlayerProfile,
  restoreLegacyPlayer,
  type PlayerProfileInput,
} from '#lib/domain/players';
import { normalizeTeamProfile } from '#lib/domain/teams';
import { TeamRepository } from './teams';
import { requireRecord, StorageError, storageOperation, validateRecord } from './errors';

interface CreateMatchInput {
  readonly id: string;
  readonly gameVersionId: string;
  readonly variantId?: string;
  readonly playerIds: readonly string[];
  readonly teamIds: readonly string[];
  readonly organizerPlayerId: string;
  readonly mode: MatchMode;
  readonly settings: JsonObject;
  readonly createdAt: string;
}

interface AppendEventInput extends Omit<ScoreEventRecord, 'sequence'> {
  readonly expectedVersion: number;
  readonly projection: Omit<MatchProjectionRecord, 'matchId' | 'lastEventSequence'>;
}

function validateId(id: string) {
  validateRecord(typeof id === 'string' && id.trim().length > 0 && id.length <= 128);
}
function validateDate(date: string) {
  validateRecord(typeof date === 'string' && Number.isFinite(Date.parse(date)));
}
function validateName(name: string) {
  validateRecord(typeof name === 'string' && name.trim().length > 0 && name.length <= 120);
}
function validateIds(ids: readonly string[]) {
  ids.forEach(validateId);
  validateRecord(new Set(ids).size === ids.length);
}

// This adapter enforces storage integrity, not game rules. Callers must use the pure
// engine before appending an event; this is not a peer/import JSON entry point.
export class LocalRepository {
  constructor(private readonly database: LocalDatabase) {}

  async savePlayer(player: PlayerRecord): Promise<void> {
    validateId(player.id);
    validateName(player.displayName);
    validateDate(player.createdAt);
    validateDate(player.updatedAt);
    validateRecord(player.deletedAt === undefined);
    const normalized = normalizePlayerProfile(player);
    await storageOperation(() =>
      this.database.transaction('rw', this.database.players, async () => {
        if ((await this.database.players.get(player.id))?.deletedAt)
          throw new StorageError('conflict');
        await this.database.players.put({ ...restoreLegacyPlayer(player), ...normalized });
      }),
    );
  }

  async createPlayer(player: PlayerRecord): Promise<void> {
    validateId(player.id);
    validateDate(player.createdAt);
    validateDate(player.updatedAt);
    validateRecord(player.deletedAt === undefined);
    const profile = normalizePlayerProfile(player);
    await storageOperation(async () => {
      await this.database.players.add({ ...restoreLegacyPlayer(player), ...profile, revision: 1 });
    });
  }

  async updatePlayer(
    id: string,
    profile: PlayerProfileInput,
    expectedRevision: number,
    updatedAt: string,
  ): Promise<void> {
    const normalized = normalizePlayerProfile(profile);
    validateDate(updatedAt);
    const db = this.database;
    await storageOperation(() =>
      db.transaction('rw', db.players, async () => {
        const current = requireRecord(await db.players.get(id));
        if ((current.revision ?? 0) !== expectedRevision || current.deletedAt)
          throw new StorageError('conflict');
        await db.players.put({
          ...current,
          ...normalized,
          revision: expectedRevision + 1,
          updatedAt,
        });
      }),
    );
  }

  async deletePlayer(id: string, expectedRevision: number, deletedAt: string): Promise<void> {
    return this.deletePlayers([{ id, expectedRevision }], deletedAt);
  }

  async deletePlayers(
    players: readonly { readonly id: string; readonly expectedRevision: number }[],
    deletedAt: string,
  ): Promise<void> {
    validateDate(deletedAt);
    validateRecord(players.length > 0 && players.length <= 256);
    const targets = players.map(({ id, expectedRevision }) => {
      validateId(id);
      validateRecord(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0);
      return { id, expectedRevision };
    });
    validateRecord(new Set(targets.map((player) => player.id)).size === targets.length);
    const db = this.database;
    await storageOperation(() =>
      db.transaction('rw', [db.players, db.teams, db.teamMemberships], async () => {
        const affectedTeams = new Set<string>();
        for (const { id, expectedRevision } of targets) {
          const current = requireRecord(await db.players.get(id));
          if (current.deletedAt) continue;
          if ((current.revision ?? 0) !== expectedRevision) throw new StorageError('conflict');
          // Keep only the reference needed by rosters/history; discard email and cached profile photo.
          await db.players.put({
            id: current.id,
            displayName: current.displayName,
            color: current.color,
            isGuest: current.isGuest,
            avatar: 'initials',
            createdAt: current.createdAt,
            updatedAt: deletedAt,
            deletedAt,
            revision: expectedRevision + 1,
          });
          const members = await db.teamMemberships
            .where('playerId')
            .equals(id)
            .filter((member) => !member.leftAt)
            .toArray();
          for (const member of members) affectedTeams.add(member.teamId);
        }
        for (const teamId of affectedTeams) {
          const team = requireRecord(await db.teams.get(teamId));
          await db.teams.put({ ...team, revision: (team.revision ?? 0) + 1, updatedAt: deletedAt });
        }
      }),
    );
  }

  async listPlayers({ search = '', page = 0 }: { search?: string; page?: number } = {}) {
    validateRecord(Number.isSafeInteger(page) && page >= 0);
    const prefix = search.trim();
    return storageOperation(async () => {
      const query = prefix
        ? this.database.players.where('displayName').startsWithIgnoreCase(prefix)
        : this.database.players.orderBy('displayName');
      const rows = await query
        .filter((player) => !player.deletedAt)
        .offset(page * 24)
        .limit(25)
        .toArray();
      return { items: rows.slice(0, 24), hasMore: rows.length > 24 };
    });
  }

  async saveTeam(team: TeamRecord, playerIds: readonly string[]): Promise<void> {
    await new TeamRepository(this.database).saveTeam(team, playerIds);
  }

  async saveGame(game: GameRecord): Promise<void> {
    validateId(game.id);
    validateId(game.slug);
    validateName(game.name);
    await storageOperation(async () => {
      await this.database.games.put(game);
    });
  }

  async publishGameVersion(version: GameVersionRecord): Promise<void> {
    validateId(version.id);
    validateId(version.rulesetVersion);
    validateDate(version.publishedAt);
    validateRecord(Number.isSafeInteger(version.schemaVersion) && version.schemaVersion > 0);
    const db = this.database;
    await storageOperation(() =>
      db.transaction('rw', [db.games, db.gameVersions], async () => {
        requireRecord(await db.games.get(version.gameId));
        // add + unique game/version index: published definitions cannot be replaced.
        await db.gameVersions.add(version);
      }),
    );
  }

  async saveVariant(variant: VariantRecord): Promise<void> {
    validateId(variant.id);
    validateName(variant.name);
    const db = this.database;
    await storageOperation(() =>
      db.transaction('rw', [db.gameVersions, db.variants], async () => {
        requireRecord(await db.gameVersions.get(variant.gameVersionId));
        await db.variants.put(variant);
      }),
    );
  }

  async createMatch(input: CreateMatchInput): Promise<MatchRecord> {
    validateId(input.id);
    validateDate(input.createdAt);
    validateIds(input.playerIds);
    validateIds(input.teamIds);
    validateRecord(!input.teamIds.some((id) => input.playerIds.includes(id)));
    validateRecord(input.playerIds.length > 0 && input.playerIds.includes(input.organizerPlayerId));
    const db = this.database;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [
          db.players,
          db.teams,
          db.teamMemberships,
          db.gameVersions,
          db.variants,
          db.matches,
          db.matchProjections,
          db.matchPermissions,
        ],
        async () => {
          const rules = requireRecord(await db.gameVersions.get(input.gameVersionId));
          const variant = input.variantId
            ? requireRecord(await db.variants.get(input.variantId))
            : undefined;
          if (variant) validateRecord(variant.gameVersionId === rules.id);
          const playersSnapshot = [];
          for (const id of input.playerIds) {
            const player = requireRecord(await db.players.get(id));
            validateRecord(!player.deletedAt && !player.archivedAt);
            playersSnapshot.push({
              id,
              displayName: player.displayName,
              color: player.color,
              isGuest: player.isGuest,
              avatar: player.avatar,
              avatarImage: player.avatarImage,
            });
          }
          const teamsSnapshot = [];
          for (const id of input.teamIds) {
            const team = requireRecord(await db.teams.get(id));
            validateRecord(!team.archivedAt && !team.deletedAt);
            const members = (await db.teamMemberships.where('teamId').equals(id).toArray()).filter(
              (member) => !member.leftAt,
            );
            validateRecord(
              members.length > 0 &&
                members.every((member) => input.playerIds.includes(member.playerId)),
            );
            const appearance = normalizeTeamProfile(
              team,
              members.map((member) => member.playerId),
            );
            teamsSnapshot.push({
              id,
              name: team.name,
              color: team.color,
              avatar: appearance.avatar,
              kind: appearance.kind,
              format: appearance.format,
              playerIds: input.playerIds.filter((playerId) =>
                members.some((member) => member.playerId === playerId),
              ),
            });
          }
          const teamPlayers = teamsSnapshot.flatMap((team) => team.playerIds);
          validateRecord(new Set(teamPlayers).size === teamPlayers.length);
          const match: MatchRecord = {
            id: input.id,
            gameVersionId: rules.id,
            organizerPlayerId: input.organizerPlayerId,
            mode: input.mode,
            status: 'draft',
            version: 0,
            settingsSnapshot: { ...variant?.settings, ...input.settings },
            rulesSnapshot: rules,
            playersSnapshot,
            teamsSnapshot,
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          };
          await db.matches.add(match);
          await db.matchProjections.add({
            matchId: match.id,
            lastEventSequence: 0,
            totals: {},
            status: 'draft',
          });
          await db.matchPermissions.add({
            matchId: match.id,
            playerId: input.organizerPlayerId,
            role: 'organizer',
            grantedBy: input.organizerPlayerId,
            revision: 1,
          });
          return match;
        },
      ),
    );
  }

  async addRound(round: RoundRecord): Promise<void> {
    validateId(round.id);
    validateRecord(Number.isSafeInteger(round.sequence) && round.sequence > 0);
    const db = this.database;
    await storageOperation(() =>
      db.transaction('rw', [db.matches, db.rounds], async () => {
        requireRecord(await db.matches.get(round.matchId));
        await db.rounds.add(round);
      }),
    );
  }

  async appendScoreEvent(input: AppendEventInput): Promise<ScoreEventRecord> {
    validateId(input.id);
    validateId(input.commandId);
    validateDate(input.timestamp);
    validateRecord(Number.isSafeInteger(input.expectedVersion) && input.expectedVersion >= 0);
    validateRecord(Object.values(input.projection.totals).every(Number.isFinite));
    const db = this.database;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [db.matches, db.rounds, db.scoreEvents, db.matchProjections],
        async () => {
          const match = requireRecord(await db.matches.get(input.matchId));
          if (input.expectedVersion !== match.version) throw new StorageError('conflict');
          if (input.actorPlayerId !== match.organizerPlayerId)
            throw new StorageError('unauthorized');
          if (
            await db.scoreEvents
              .where('[matchId+commandId]')
              .equals([match.id, input.commandId])
              .count()
          )
            throw new StorageError('conflict');
          if (input.roundId)
            validateRecord(requireRecord(await db.rounds.get(input.roundId)).matchId === match.id);
          if (input.supersedesId)
            validateRecord(
              requireRecord(await db.scoreEvents.get(input.supersedesId)).matchId === match.id,
            );
          const owners = [...match.playersSnapshot, ...match.teamsSnapshot].map(
            (owner) => owner.id,
          );
          validateRecord(Object.keys(input.projection.totals).every((id) => owners.includes(id)));
          if (input.projection.winnerId) validateRecord(owners.includes(input.projection.winnerId));
          const sequence = match.version + 1;
          const { projection } = input;
          const event: ScoreEventRecord = {
            id: input.id,
            matchId: match.id,
            roundId: input.roundId,
            sequence,
            commandId: input.commandId,
            actorPlayerId: input.actorPlayerId,
            payload: input.payload,
            supersedesId: input.supersedesId,
            timestamp: input.timestamp,
          };
          await db.scoreEvents.add(event);
          await db.matchProjections.put({
            ...projection,
            matchId: match.id,
            lastEventSequence: sequence,
          });
          await db.matches.put({
            ...match,
            version: sequence,
            status: projection.status,
            updatedAt: input.timestamp,
          });
          return event;
        },
      ),
    );
  }

  async readMatch(id: string) {
    const db = this.database;
    return storageOperation(() =>
      db.transaction(
        'r',
        [db.matches, db.rounds, db.scoreEvents, db.matchProjections, db.matchPermissions],
        async () => {
          const match = requireRecord(await db.matches.get(id));
          return {
            match,
            projection: requireRecord(await db.matchProjections.get(id)),
            rounds: await db.rounds
              .where('[matchId+sequence]')
              .between([id, 0], [id, Infinity])
              .toArray(),
            events: await db.scoreEvents
              .where('[matchId+sequence]')
              .between([id, 0], [id, Infinity])
              .toArray(),
            permissions: await db.matchPermissions.where('matchId').equals(id).toArray(),
          };
        },
      ),
    );
  }
}
