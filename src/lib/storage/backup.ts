import { restoreLegacyTeam } from '#lib/domain/teams';
import { decodePeerJournal, MAX_PEER_JOURNAL } from '#lib/domain/peer-journal';
import type { LocalDatabase } from './database';
import { gameCatalog } from '#lib/domain/games/catalog';
import { storageOperation, validateRecord, StorageError } from './errors';
import { normalizePlayerProfile, restoreLegacyPlayer } from '#lib/domain/players';
import { normalizeTeamProfile, makeTeamReusable } from '#lib/domain/teams';
import { normalizeDeviceName, normalizeTheme } from '#lib/domain/settings';
import { createGame } from '#lib/domain/games/engine';
import { petanqueVersion } from '#lib/domain/games/petanque';
import { replayJournal, journalTimestamp } from '#lib/domain/journal';
import type {
  PlayerRecord,
  TeamRecord,
  TeamMembershipRecord,
  GameRecord,
  GameVersionRecord,
  VariantRecord,
  MatchRecord,
  RoundRecord,
  ScoreEventRecord,
  MatchPermissionRecord,
  MatchAuthorityRecord,
  PeerReplicaRecord,
} from '#lib/domain/records';
export const backupTables = [
  'deviceSettings',
  'players',
  'teams',
  'teamMemberships',
  'games',
  'gameVersions',
  'variants',
  'matches',
  'rounds',
  'scoreEvents',
  'matchPermissions',
  'matchAuthorities',
  'peerReplicas',
] as const;
type TableName = (typeof backupTables)[number];
type Row = Record<string, unknown>;
interface Backup {
  format: 'scoretrackrr-backup';
  formatVersion: 2;
  schemaVersion: 4 | 5 | 6 | 7;
  exportedAt: string;
  tables: Record<TableName, Row[]>;
}
export const MAX_BACKUP_SIZE = 20 * 1024 * 1024;
function id(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0 && input.length <= 128;
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function inspectJson(input: unknown) {
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    validateRecord(++nodes <= 1000000 && depth <= 30);
    if (typeof value === 'string') validateRecord(value.length <= MAX_PEER_JOURNAL);
    else if (typeof value === 'number') validateRecord(Number.isFinite(value));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        validateRecord(!['__proto__', 'constructor', 'prototype'].includes(key));
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
}
function rows<T>(data: Backup, table: TableName) {
  return data.tables[table] as unknown as T[];
}
function validateBackup(data: Backup) {
  validateRecord(
    !!data &&
      typeof data === 'object' &&
      Object.keys(data).length === 5 &&
      data.format === 'scoretrackrr-backup' &&
      data.formatVersion === 2 &&
      [4, 5, 6, 7].includes(data.schemaVersion) &&
      journalTimestamp(data.exportedAt) &&
      !!data.tables &&
      Object.keys(data.tables).length === backupTables.length,
  );
  for (const name of backupTables) {
    const values = data.tables[name];
    validateRecord(Array.isArray(values) && values.length <= 50000);
    const keys = new Set<string>();
    for (const value of values) {
      validateRecord(!!value && typeof value === 'object' && !Array.isArray(value));
      const key =
        name === 'deviceSettings'
          ? value.key
          : name === 'matchAuthorities'
            ? value.matchId
            : name === 'matchPermissions'
              ? JSON.stringify([value.matchId, value.playerId])
              : value.id;
      validateRecord(
        (name === 'matchPermissions' ? id(value.matchId) && id(value.playerId) : id(key)) &&
          !keys.has(key as string),
      );
      keys.add(key as string);
    }
  }
  const players = new Map(rows<PlayerRecord>(data, 'players').map((row) => [row.id, row]));
  const teams = new Map(rows<TeamRecord>(data, 'teams').map((row) => [row.id, row]));
  const games = new Map(rows<GameRecord>(data, 'games').map((row) => [row.id, row]));
  const versions = new Map(
    rows<GameVersionRecord>(data, 'gameVersions').map((row) => [row.id, row]),
  );
  const matches = new Map(rows<MatchRecord>(data, 'matches').map((row) => [row.id, row]));
  for (const player of players.values()) {
    normalizePlayerProfile(player);
    if (data.schemaVersion >= 6) validateRecord(player.archivedAt === undefined);
    if (player.deletedAt !== undefined)
      validateRecord(
        journalTimestamp(player.deletedAt) &&
          player.email === undefined &&
          player.avatarImage === undefined &&
          player.avatar !== 'gravatar',
      );
    validateRecord(
      journalTimestamp(player.createdAt) &&
        journalTimestamp(player.updatedAt) &&
        (!player.archivedAt || journalTimestamp(player.archivedAt)) &&
        (player.revision === undefined ||
          (Number.isSafeInteger(player.revision) && player.revision >= 0)),
    );
  }
  const memberships = rows<TeamMembershipRecord>(data, 'teamMemberships');
  for (const member of memberships)
    validateRecord(
      teams.has(member.teamId) &&
        players.has(member.playerId) &&
        journalTimestamp(member.joinedAt) &&
        (!member.leftAt || journalTimestamp(member.leftAt)),
    );
  for (const team of teams.values()) {
    const active = memberships
      .filter((member) => member.teamId === team.id && !member.leftAt)
      .map((member) => member.playerId);
    normalizeTeamProfile(team, active);
    if (data.schemaVersion >= 7) validateRecord(team.archivedAt === undefined);
    if (team.deletedAt !== undefined) validateRecord(journalTimestamp(team.deletedAt));
    if (data.schemaVersion >= 5) validateRecord(team.kind !== 'temporary' && !team.assignedMatchId);
    validateRecord(
      (team.revision === undefined ||
        (Number.isSafeInteger(team.revision) && team.revision >= 0)) &&
        (team.memberOrder === undefined || Array.isArray(team.memberOrder)) &&
        journalTimestamp(team.createdAt) &&
        journalTimestamp(team.updatedAt) &&
        (!team.archivedAt || journalTimestamp(team.archivedAt)) &&
        (!team.assignedMatchId || matches.has(team.assignedMatchId)) &&
        (!team.memberOrder || same([...team.memberOrder].sort(), [...active].sort())),
    );
  }
  for (const game of games.values())
    validateRecord(
      id(game.slug) &&
        typeof game.name === 'string' &&
        game.name.trim().length > 0 &&
        game.name.length <= 120 &&
        ['available', 'coming_soon'].includes(game.state) &&
        (game.origin === undefined || ['builtin', 'custom'].includes(game.origin)) &&
        (game.favorite === undefined || typeof game.favorite === 'boolean') &&
        (game.currentVersionId === undefined || id(game.currentVersionId)) &&
        (!game.currentVersionId || versions.get(game.currentVersionId)?.gameId === game.id),
    );
  for (const game of games.values())
    if (gameCatalog.some((known) => known.id === game.id))
      validateRecord(game.slug === game.id && game.origin !== 'custom');
  for (const version of versions.values()) {
    validateRecord(
      games.has(version.gameId) &&
        journalTimestamp(version.publishedAt) &&
        (version.name === undefined ||
          (typeof version.name === 'string' && version.name.length <= 120)),
    );
    const game = createGame(version);
    validateRecord(
      game.id === version.gameId &&
        game.rulesetVersion === version.rulesetVersion &&
        game.definition.schemaVersion === version.schemaVersion,
    );
    if (version.gameId === 'petanque')
      validateRecord(
        (['individual', 'teams'] as const).some((mode) =>
          ([11, 13] as const).some((target) =>
            same(petanqueVersion(target, '', mode).definition, version.definition),
          ),
        ),
      );
  }
  for (const variant of rows<VariantRecord>(data, 'variants'))
    validateRecord(
      versions.has(variant.gameVersionId) &&
        typeof variant.name === 'string' &&
        variant.name.length > 0 &&
        variant.name.length <= 120,
    );
  const events = rows<ScoreEventRecord>(data, 'scoreEvents');
  const byMatch = new Map<string, ScoreEventRecord[]>();
  for (const event of events) {
    validateRecord(matches.has(event.matchId));
    const group = byMatch.get(event.matchId) ?? [];
    group.push(event);
    byMatch.set(event.matchId, group);
  }
  const projections = [];
  const authorities = new Map<string, ReturnType<typeof replayJournal>['authority']>();
  for (const match of matches.values()) {
    const version = versions.get(match.gameVersionId);
    validateRecord(
      !!version &&
        same(match.rulesSnapshot.definition, version.definition) &&
        match.rulesSnapshot.rulesetVersion === version.rulesetVersion &&
        journalTimestamp(match.createdAt) &&
        journalTimestamp(match.updatedAt),
    );
    validateRecord(Array.isArray(match.playersSnapshot) && Array.isArray(match.teamsSnapshot));
    for (const player of match.playersSnapshot) {
      validateRecord(players.has(player.id) && !Object.hasOwn(player, 'email'));
      normalizePlayerProfile({
        ...player,
        email: player.avatar === 'gravatar' ? 'snapshot@example.invalid' : undefined,
      });
    }
    for (const team of match.teamsSnapshot) {
      validateRecord(
        teams.has(team.id) && team.playerIds.every((player: string) => players.has(player)),
      );
      normalizeTeamProfile(team, team.playerIds);
    }
    const replay = replayJournal(
      match,
      (byMatch.get(match.id) ?? []).sort((a, b) => a.sequence - b.sequence),
    );
    validateRecord(replay.projection.status === match.status);
    projections.push(replay.projection);
    authorities.set(match.id, replay.authority);
  }
  for (const round of rows<RoundRecord>(data, 'rounds'))
    validateRecord(
      matches.has(round.matchId) &&
        Number.isSafeInteger(round.sequence) &&
        round.sequence > 0 &&
        ['open', 'closed', 'void'].includes(round.status),
    );
  for (const permission of rows<MatchPermissionRecord>(data, 'matchPermissions')) {
    const match = matches.get(permission.matchId);
    validateRecord(
      !!match &&
        match.playersSnapshot.some((player) => player.id === permission.playerId) &&
        permission.grantedBy === authorities.get(match.id)?.playerId &&
        players.has(permission.grantedBy) &&
        ['organizer', 'manager', 'scorer', 'viewer'].includes(permission.role) &&
        (permission.sessionId === undefined || id(permission.sessionId)) &&
        Number.isSafeInteger(permission.revision) &&
        permission.revision >= 0 &&
        (permission.role !== 'organizer' ||
          permission.playerId === authorities.get(match.id)?.playerId),
    );
  }
  for (const fence of rows<MatchAuthorityRecord>(data, 'matchAuthorities')) {
    const current = authorities.get(fence.matchId),
      match = matches.get(fence.matchId);
    validateRecord(
      !!current &&
        !!match &&
        id(fence.deviceId) &&
        fence.playerId === current.playerId &&
        fence.epoch === current.epoch &&
        ['active', 'prepared', 'released'].includes(fence.state) &&
        (!current.deviceId || fence.deviceId === current.deviceId),
    );
    if (fence.state === 'prepared')
      validateRecord(
        id(fence.transferId) &&
          id(fence.targetSessionId) &&
          fence.targetPlayerId !== fence.playerId &&
          match.playersSnapshot.some((p) => p.id === fence.targetPlayerId) &&
          fence.baseVersion === match.version &&
          (fence.targetDeviceId === undefined ||
            (id(fence.targetDeviceId) && fence.targetDeviceId !== fence.deviceId)),
      );
    else validateRecord(fence.transferId === undefined || fence.transferId === current.transferId);
  }
  for (const replica of rows<PeerReplicaRecord>(data, 'peerReplicas')) {
    const staged = decodePeerJournal(replica.text);
    validateRecord(
      id(replica.id) &&
        id(replica.deviceId) &&
        journalTimestamp(replica.acceptedAt) &&
        staged.match.id === replica.matchId &&
        staged.match.version === replica.baseVersion &&
        staged.match.playersSnapshot.some((p) => p.id === replica.targetPlayerId),
    );
  }
  for (const setting of data.tables.deviceSettings) {
    validateRecord(
      ['deviceName', 'theme'].includes(setting.key as string) && typeof setting.value === 'string',
    );
    if (setting.key === 'deviceName') normalizeDeviceName(setting.value as string);
    else normalizeTheme(setting.value);
  }
  return projections;
}
export class BackupRepository {
  constructor(private db: LocalDatabase) {}
  async export(exportedAt: string) {
    validateRecord(journalTimestamp(exportedAt));
    const data = await storageOperation(() =>
      this.db.transaction(
        'r',
        backupTables.map((name) => this.db.table(name)),
        async () => {
          const tables = {} as Backup['tables'];
          for (const name of backupTables) {
            const records = await this.db.table(name).limit(50001).toArray();
            validateRecord(records.length <= 50000);
            tables[name] =
              name === 'deviceSettings'
                ? records.filter((row) => ['deviceName', 'theme'].includes(row.key))
                : records;
          }
          return {
            format: 'scoretrackrr-backup' as const,
            formatVersion: 2 as const,
            schemaVersion: 7 as const,
            exportedAt,
            tables,
          };
        },
      ),
    );
    validateBackup(data);
    const text = JSON.stringify(data);
    validateRecord(
      text.length <= MAX_BACKUP_SIZE &&
        new TextEncoder().encode(text).byteLength <= MAX_BACKUP_SIZE,
    );
    return text;
  }
  async restore(text: string) {
    validateRecord(
      typeof text === 'string' &&
        text.length <= MAX_BACKUP_SIZE &&
        new TextEncoder().encode(text).byteLength <= MAX_BACKUP_SIZE,
    );
    let data: Backup;
    try {
      data = JSON.parse(text) as Backup;
    } catch {
      throw new StorageError('invalid_record');
    }
    inspectJson(data);
    const legacy = data as unknown as {
      formatVersion: number;
      schemaVersion: number;
      tables: Record<string, Row[]>;
    };
    if (
      legacy.formatVersion === 1 &&
      legacy.schemaVersion === 3 &&
      legacy.tables &&
      Object.keys(legacy.tables).length === backupTables.length - 2 &&
      !Object.hasOwn(legacy.tables, 'matchAuthorities') &&
      !Object.hasOwn(legacy.tables, 'peerReplicas')
    ) {
      legacy.formatVersion = 2;
      legacy.schemaVersion = 4;
      legacy.tables.matchAuthorities = [];
      legacy.tables.peerReplicas = [];
    }
    const projections = validateBackup(data);
    if (data.schemaVersion === 4) {
      data.tables.teams = rows<TeamRecord>(data, 'teams').map(makeTeamReusable) as unknown as Row[];
    }
    if (data.schemaVersion < 6) {
      data.tables.players = rows<PlayerRecord>(data, 'players').map(
        restoreLegacyPlayer,
      ) as unknown as Row[];
      data.schemaVersion = 6;
    }
    if (data.schemaVersion < 7) {
      data.tables.teams = rows<TeamRecord>(data, 'teams').map(
        restoreLegacyTeam,
      ) as unknown as Row[];
      data.schemaVersion = 7;
    }
    const db = this.db;
    return storageOperation(() =>
      db.transaction(
        'rw',
        [...backupTables.map((name) => db.table(name)), db.matchProjections],
        async () => {
          const baseline =
            (await db.matches.count()) === 0 &&
            (await db.players.count()) === 0 &&
            (await db.teams.count()) === 0;
          let added = 0,
            duplicates = 0;
          for (const name of backupTables) {
            const table = db.table(name);
            for (const savedRow of data.tables[name]) {
              const known =
                name === 'games' ? gameCatalog.find((game) => game.id === savedRow.id) : undefined;
              const row = known
                ? { ...savedRow, name: known.name, state: known.state, origin: 'builtin' }
                : savedRow;
              const key =
                name === 'deviceSettings'
                  ? row.key
                  : name === 'matchAuthorities'
                    ? row.matchId
                    : name === 'matchPermissions'
                      ? [row.matchId, row.playerId]
                      : row.id;
              const existing = await table.get(key as string | string[]);
              if (existing) {
                if (same(existing, row)) {
                  duplicates++;
                  continue;
                }
                if (name === 'deviceSettings') continue;
                const seededVersion =
                  baseline &&
                  name === 'gameVersions' &&
                  gameCatalog.some((game) => game.id === row.gameId) &&
                  same({ ...existing, publishedAt: row.publishedAt }, row);
                const seededGame =
                  baseline &&
                  name === 'games' &&
                  existing.origin === 'builtin' &&
                  existing.favorite === undefined &&
                  same({ ...existing, favorite: row.favorite }, row);
                if (!seededVersion && !seededGame) throw new StorageError('conflict');
                await table.put(row);
              } else {
                await table.add(row);
                added++;
              }
            }
          }
          for (const projection of projections) await db.matchProjections.put(projection);
          return { added, duplicates, matches: data.tables.matches.length };
        },
      ),
    );
  }
}

export async function exportHistoryCsv(db: LocalDatabase) {
  const { MatchJournal } = await import('./journal');
  const { serializeCsv } = await import('#lib/domain/csv');
  const journal = new MatchJournal(db);
  const output: (string | number)[][] = [
    ['matchId', 'gameId', 'rulesetVersion', 'createdAt', 'status', 'winnerIds', 'totals'],
  ];
  let cursor: import('#lib/domain/history').HistoryCursor | undefined,
    more = true;
  while (more) {
    const page = await journal.history({}, cursor);
    for (const row of page.items) {
      validateRecord(output.length <= 50000);
      const { match, journal: view } = await journal.inspect(row.id);
      output.push([
        match.id,
        match.rulesSnapshot.gameId,
        match.rulesSnapshot.rulesetVersion,
        match.createdAt,
        view.projection.status,
        (view.projection.winnerIds ?? []).join('|'),
        JSON.stringify(view.projection.totals),
      ]);
    }
    more = page.hasMore;
    cursor = page.nextCursor;
  }
  const text = serializeCsv(output);
  validateRecord(text.length <= MAX_BACKUP_SIZE);
  return text;
}
export async function exportStatisticsCsv(db: LocalDatabase) {
  const { MatchJournal } = await import('./journal');
  const { calculateStatistics } = await import('./statistics');
  const { serializeCsv } = await import('#lib/domain/csv');
  const data = await calculateStatistics(new MatchJournal(db), {});
  const text = serializeCsv([
    [
      'gameId',
      'versionId',
      'kind',
      'ownerId',
      'name',
      'played',
      'wins',
      'winRate',
      'average',
      'record',
    ],
    ...data.rows.map((row) => [
      row.gameId,
      row.versionId,
      row.kind,
      row.ownerId,
      row.name,
      row.played,
      row.wins,
      row.rate,
      row.average,
      row.best,
    ]),
  ]);
  validateRecord(text.length <= MAX_BACKUP_SIZE);
  return text;
}
