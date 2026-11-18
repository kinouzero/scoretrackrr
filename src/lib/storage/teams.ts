import type { PlayerRecord, TeamRecord } from '#lib/domain/records';
import { normalizeTeamProfile, makeTeamReusable } from '#lib/domain/teams';
import type { LocalDatabase } from './database';
import { journalTimestamp } from '#lib/domain/journal';
import { requireRecord, storageOperation, StorageError, validateRecord } from './errors';

export interface TeamRoster {
  readonly team: TeamRecord;
  readonly members: readonly PlayerRecord[];
}
interface TeamWrite {
  readonly team: TeamRecord;
  readonly playerIds: readonly string[];
}
interface WriteOptions {
  readonly create?: boolean;
  readonly expectedRevision?: number;
}

export class TeamRepository {
  constructor(private readonly database: LocalDatabase) {}

  async saveTeam(
    team: TeamRecord,
    playerIds: readonly string[],
    options: WriteOptions = {},
  ): Promise<void> {
    await storageOperation(() =>
      this.database.transaction(
        'rw',
        [this.database.players, this.database.teams, this.database.teamMemberships],
        () => this.writeTeam({ team, playerIds }, options),
      ),
    );
  }

  async createTeams(teams: readonly TeamWrite[]): Promise<void> {
    validateRecord(teams.length >= 2 && teams.length <= 32);
    const ids = teams.flatMap((team) => [...team.playerIds]);
    validateRecord(
      ids.length <= 256 &&
        new Set(ids).size === ids.length &&
        new Set(teams.map((item) => item.team.id)).size === teams.length,
    );
    await storageOperation(() =>
      this.database.transaction(
        'rw',
        [this.database.players, this.database.teams, this.database.teamMemberships],
        async () => {
          for (const team of teams) await this.writeTeam(team, { create: true });
        },
      ),
    );
  }

  private async writeTeam({ team, playerIds }: TeamWrite, options: WriteOptions): Promise<void> {
    validateRecord(team.deletedAt === undefined && team.archivedAt === undefined);
    team = makeTeamReusable(team);
    const profile = normalizeTeamProfile(team, playerIds);
    validateRecord(
      typeof team.id === 'string' && team.id.trim().length > 0 && team.id.length <= 128,
    );
    validateRecord(
      Number.isFinite(Date.parse(team.createdAt)) && Number.isFinite(Date.parse(team.updatedAt)),
    );
    const db = this.database;
    const current = await db.teams.get(team.id);
    if (
      current?.deletedAt ||
      (options.create && current) ||
      (options.expectedRevision !== undefined &&
        (!current || current.archivedAt || (current.revision ?? 0) !== options.expectedRevision))
    )
      throw new StorageError('conflict');
    const players = await db.players.bulkGet([...playerIds]);
    players.forEach((player) =>
      validateRecord(!requireRecord(player).deletedAt && !player!.archivedAt),
    );
    const active = (await db.teamMemberships.where('teamId').equals(team.id).toArray()).filter(
      (member) => !member.leftAt,
    );
    for (const member of active) {
      if (!playerIds.includes(member.playerId))
        await db.teamMemberships.put({ ...member, leftAt: team.updatedAt });
    }
    for (const playerId of playerIds) {
      if (!active.some((member) => member.playerId === playerId))
        await db.teamMemberships.add({
          id: crypto.randomUUID(),
          teamId: team.id,
          playerId,
          joinedAt: team.updatedAt,
        });
    }
    await db.teams.put({
      ...team,
      ...profile,
      createdAt: current?.createdAt ?? team.createdAt,
      memberOrder: [...playerIds],
      revision: (current?.revision ?? 0) + 1,
    });
  }

  async deleteTeam(id: string, expectedRevision: number, deletedAt: string): Promise<void> {
    validateRecord(
      typeof id === 'string' &&
        id.trim().length > 0 &&
        id.length <= 128 &&
        Number.isSafeInteger(expectedRevision) &&
        expectedRevision >= 0 &&
        journalTimestamp(deletedAt),
    );
    const db = this.database;
    await storageOperation(() =>
      db.transaction('rw', db.teams, async () => {
        const current = requireRecord(await db.teams.get(id));
        if (current.deletedAt) return;
        if ((current.revision ?? 0) !== expectedRevision) throw new StorageError('conflict');
        // Retain references required by saved rosters and backups; snapshots remain untouched.
        await db.teams.put({
          ...current,
          deletedAt,
          updatedAt: deletedAt,
          revision: expectedRevision + 1,
        });
      }),
    );
  }

  async listTeams({ search = '', page = 0 }: { search?: string; page?: number } = {}) {
    validateRecord(Number.isSafeInteger(page) && page >= 0);
    const db = this.database;
    return storageOperation(() =>
      db.transaction('r', [db.teams, db.teamMemberships, db.players], async () => {
        const query = search.trim()
          ? db.teams.where('name').startsWithIgnoreCase(search.trim())
          : db.teams.orderBy('name');
        const rows = await query
          .filter((team) => !team.deletedAt)
          .offset(page * 24)
          .limit(25)
          .toArray();
        const teams = rows.slice(0, 24);
        const memberships = teams.length
          ? (
              await db.teamMemberships
                .where('teamId')
                .anyOf(teams.map((team) => team.id))
                .toArray()
            ).filter((member) => !member.leftAt)
          : [];
        const playerIds = [...new Set(memberships.map((member) => member.playerId))];
        const players = new Map(
          (await db.players.bulkGet(playerIds)).map((player) => {
            const record = requireRecord(player);
            return [record.id, record] as const;
          }),
        );
        const items: TeamRoster[] = teams.map((team) => {
          const ids = memberships
            .filter((member) => member.teamId === team.id)
            .map((member) => member.playerId);
          const order = team.memberOrder ?? [...ids].sort();
          return {
            team,
            members: order
              .filter((id) => ids.includes(id))
              .map((id) => requireRecord(players.get(id))),
          };
        });
        return { items, hasMore: rows.length > 24 };
      }),
    );
  }
}
