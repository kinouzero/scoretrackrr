import type { LocalDatabase } from './database';
import type { TeamRoster } from './teams';
import { StorageError } from './errors';
export async function presetParticipants(db: LocalDatabase, playerIds: unknown, teamIds: unknown) {
  const ids = (value: unknown): string[] => {
    if (
      !Array.isArray(value) ||
      value.length > 64 ||
      value.some((id) => typeof id !== 'string' || id.length > 128) ||
      new Set(value).size !== value.length
    )
      throw new StorageError('invalid_record');
    return value as string[];
  };
  const pids = ids(playerIds),
    tids = ids(teamIds);
  if (tids.length > 16) throw new StorageError('invalid_record');
  return db.transaction('r', db.players, db.teams, db.teamMemberships, async () => {
    const teams = await db.teams.bulkGet(tids);
    if (teams.some((team) => !team || team.deletedAt)) throw new StorageError('missing_reference');
    const memberships = tids.length
      ? (await db.teamMemberships.where('teamId').anyOf(tids).toArray()).filter(
          (member) => !member.leftAt,
        )
      : [];
    const membersByTeam = new Map<string, string[]>();
    for (const membership of memberships) {
      const members = membersByTeam.get(membership.teamId) ?? [];
      members.push(membership.playerId);
      membersByTeam.set(membership.teamId, members);
    }
    const orderedIds = teams.map((team) => {
      const active = new Set(membersByTeam.get(team!.id) ?? []);
      return (team!.memberOrder ?? [...active].sort()).filter((id) => active.has(id));
    });
    const allIds = [...new Set([...pids, ...orderedIds.flat()])];
    const records = await db.players.bulkGet(allIds);
    if (
      records.some((player) => !player || player.deletedAt || player.archivedAt) ||
      orderedIds.some((ids) => !ids.length)
    )
      throw new StorageError('missing_reference');
    const playersById = new Map(records.map((player) => [player!.id, player!]));
    const rosters: TeamRoster[] = teams.map((team, index) => ({
      team: team!,
      members: orderedIds[index]!.map((id) => playersById.get(id)!),
    }));
    return { players: pids.map((id) => playersById.get(id)!), rosters };
  });
}
