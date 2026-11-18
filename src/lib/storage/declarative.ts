import { isScoreSheet } from '#lib/domain/games/score-sheets';
import { configuredSixNimmtVersion, type SixNimmtOptions } from '#lib/domain/games/six-nimmt';
import { configuredSkullKingVersion, type SkullKingOptions } from '#lib/domain/games/skull-king';
import { x01Version } from '#lib/domain/games/darts';
import type { GameVersionRecord } from '#lib/domain/records';
import { dartsCorkOrder } from '#lib/domain/games/darts-cork';
import { configuredYamsVersion, type YamsOptions } from '#lib/domain/games/yams';
import { configuredTimesUpVersion, type TimesUpOptions } from '#lib/domain/games/times-up';
import { dartsMatchOptions, type DartsMatchOptions } from '#lib/domain/games/darts-match';
import type { MatchMode } from '#lib/domain/records';
import { createGame } from '#lib/domain/games/engine';
import { replayJournal } from '#lib/domain/journal';
import { copyBoundedJson } from '#lib/domain/engine/validation';
import type { LocalDatabase } from './database';
import { LocalRepository } from './repository';
import { TeamRepository } from './teams';
import { requireRecord, storageOperation, StorageError, validateRecord } from './errors';

export interface CreateDeclarativeInput {
  readonly id: string;
  readonly versionId: string;
  readonly mode: MatchMode;
  readonly playerIds: readonly string[];
  readonly teams: readonly { readonly id: string; readonly revision: number }[];
  readonly organizerPlayerId: string;
  readonly cooperativeName: string;
  readonly createdAt: string;
  readonly dartsMatch?: DartsMatchOptions;
  readonly dartsCorkWinnerId?: string;
  readonly yamsOptions?: YamsOptions;
  readonly sixNimmtOptions?: SixNimmtOptions;
  readonly skullKingOptions?: SkullKingOptions;
  readonly timesUpOptions?: TimesUpOptions;
  readonly x01Start?: number;
}
export class DeclarativeRepository {
  constructor(private readonly db: LocalDatabase) {}

  async create(submission: CreateDeclarativeInput) {
    const input = copyBoundedJson(submission) as CreateDeclarativeInput;
    const mode = input.mode;
    validateRecord(
      ['individual', 'teams', 'cooperative', 'mixed'].includes(mode) &&
        input.playerIds.length <= 64 &&
        input.teams.length <= 16 &&
        new Set(input.playerIds).size === input.playerIds.length &&
        new Set(input.teams.map((team) => team.id)).size === input.teams.length,
    );
    validateRecord(
      mode === 'individual' || mode === 'cooperative'
        ? input.playerIds.length >= (mode === 'individual' ? 1 : 2) && input.teams.length === 0
        : mode === 'teams'
          ? input.teams.length >= 2 && input.playerIds.length === 0
          : input.teams.length >= 1 && input.playerIds.length >= 1,
    );
    validateRecord(mode !== 'cooperative' || input.playerIds.length <= 32);
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
        ],
        async () => {
          let version = requireRecord(await db.gameVersions.get(input.versionId));
          if (mode === 'individual' && version.gameId !== 'clever')
            validateRecord(input.playerIds.length >= 2);
          let configured: GameVersionRecord | undefined;
          if (input.yamsOptions !== undefined) {
            validateRecord(version.gameId === 'yams');
            configured = configuredYamsVersion(input.yamsOptions, input.createdAt);
          }
          if (input.sixNimmtOptions !== undefined) {
            validateRecord(version.gameId === '6-qui-prend');
            configured = configuredSixNimmtVersion(input.sixNimmtOptions, input.createdAt);
          }
          if (input.skullKingOptions !== undefined) {
            validateRecord(version.gameId === 'skull-king');
            configured = configuredSkullKingVersion(input.skullKingOptions, input.createdAt);
          }
          if (input.timesUpOptions !== undefined) {
            validateRecord(version.gameId === 'times-up');
            configured = configuredTimesUpVersion(input.timesUpOptions, input.createdAt);
          }
          if (input.x01Start !== undefined) {
            validateRecord(
              version.gameId === 'darts' &&
                version.definition.engine === 'x01' &&
                typeof version.definition.doubleOut === 'boolean',
            );
            configured = x01Version(input.x01Start, version.definition.doubleOut, input.createdAt);
          }
          if (configured) {
            const saved = await db.gameVersions.get(configured.id);
            if (saved) {
              if (
                saved.gameId !== configured.gameId ||
                saved.rulesetVersion !== configured.rulesetVersion ||
                saved.schemaVersion !== configured.schemaVersion ||
                JSON.stringify(saved.definition) !== JSON.stringify(configured.definition)
              )
                throw new StorageError('conflict');
              version = saved;
            } else {
              await db.gameVersions.add(configured);
              version = configured;
            }
          }
          const record = requireRecord(await db.games.get(version.gameId));
          validateRecord(
            (record.origin === 'custom' ||
              isScoreSheet(record.id) ||
              [
                'yams',
                '421',
                '5000-10000',
                'darts',
                'skull-king',
                'flip-7',
                'molkky',
                '6-qui-prend',
                'times-up',
              ].includes(record.id)) &&
              record.state === 'available',
          );
          if (input.dartsMatch !== undefined) validateRecord(version.gameId === 'darts');
          const options =
            input.dartsMatch === undefined ? undefined : dartsMatchOptions(input.dartsMatch);
          const game = createGame(version, options);
          validateRecord(
            game.id === version.gameId &&
              game.rulesetVersion === version.rulesetVersion &&
              game.definition.schemaVersion === version.schemaVersion,
          );
          const teamIds = input.teams.map((team) => team.id);
          const playerIds = [...input.playerIds];
          for (const reference of input.teams) {
            const team = requireRecord(await db.teams.get(reference.id));
            if ((team.revision ?? 0) !== reference.revision || team.archivedAt || team.deletedAt)
              throw new StorageError('conflict');
            const members = await db.teamMemberships
              .where('teamId')
              .equals(team.id)
              .filter((member) => !member.leftAt)
              .toArray();
            const order = team.memberOrder ?? members.map((member) => member.playerId).sort();
            validateRecord(
              order.length === members.length &&
                new Set(order).size === members.length &&
                order.every((id) => members.some((member) => member.playerId === id)),
            );
            if (version.gameId === 'times-up') validateRecord(order.length >= 2);
            if (version.gameId === 'belote') validateRecord(order.length === 2);
            playerIds.push(...order);
          }
          validateRecord(playerIds.length <= 256 && new Set(playerIds).size === playerIds.length);
          if (version.gameId === 'times-up')
            validateRecord(playerIds.length >= 4 && playerIds.length <= 12);
          if (mode === 'cooperative') {
            const id = `${input.id}-group`;
            await new TeamRepository(db).saveTeam(
              {
                id,
                name: input.cooperativeName,
                color: '#153e35',
                kind: 'permanent',
                format: 'free',
                createdAt: input.createdAt,
                updatedAt: input.createdAt,
              },
              playerIds,
              { create: true },
            );
            teamIds.push(id);
          }
          let ownerIds =
            mode === 'individual'
              ? playerIds
              : mode === 'mixed'
                ? [...teamIds, ...input.playerIds]
                : teamIds;
          if (input.dartsCorkWinnerId !== undefined) {
            validateRecord(version.gameId === 'darts');
            ownerIds = dartsCorkOrder(ownerIds, input.dartsCorkWinnerId);
            validateRecord(!options || options.firstStarterId === input.dartsCorkWinnerId);
          }
          const config = game.validateConfig({ mode, ownerIds });
          const match = await new LocalRepository(db).createMatch({
            id: input.id,
            gameVersionId: version.id,
            playerIds,
            teamIds,
            organizerPlayerId: input.organizerPlayerId,
            mode,
            settings: {
              engineConfig: { mode: config.mode, ownerIds: [...config.ownerIds] },
              ...(options ? { dartsMatch: { ...options } } : {}),
              ...(input.dartsCorkWinnerId !== undefined
                ? { dartsCorkWinnerId: input.dartsCorkWinnerId }
                : {}),
            },
            createdAt: input.createdAt,
          });
          await db.matchProjections.put(replayJournal(match, []).projection);
          return match;
        },
      ),
    );
  }
}
