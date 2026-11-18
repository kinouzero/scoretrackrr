import type { TeamRecord } from './records';
export const teamAvatars = { initials: '', flag: '⚑', star: '★', leaf: '❧', boules: '◉' } as const;
export type TeamAvatar = keyof typeof teamAvatars;
export type TeamKind = 'permanent' | 'temporary';
export type TeamFormat = 'free' | 'petanque_doublette';

export interface TeamProfileInput {
  readonly name: string;
  readonly color: string;
  readonly avatar?: TeamAvatar;
  readonly kind?: TeamKind;
  readonly format?: TeamFormat;
}

export class TeamValidationError extends Error {
  constructor(readonly field: 'name' | 'appearance' | 'members' | 'distribution') {
    super(`INVALID_TEAM_${field}`);
    this.name = 'TeamValidationError';
  }
}

export function normalizeTeamProfile(input: TeamProfileInput, playerIds: readonly string[]) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 120 || /\p{Cc}/u.test(name)) throw new TeamValidationError('name');
  const avatar = input.avatar ?? 'initials';
  const kind = input.kind ?? 'permanent';
  const format = input.format ?? 'free';
  if (
    !/^#[0-9a-f]{6}$/i.test(input.color) ||
    !Object.hasOwn(teamAvatars, avatar) ||
    !['permanent', 'temporary'].includes(kind) ||
    !['free', 'petanque_doublette'].includes(format)
  )
    throw new TeamValidationError('appearance');
  if (
    playerIds.length < 1 ||
    playerIds.length > 32 ||
    new Set(playerIds).size !== playerIds.length ||
    playerIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 128) ||
    (format === 'petanque_doublette' && playerIds.length !== 2)
  )
    throw new TeamValidationError('members');
  return { name, color: input.color.toLowerCase(), avatar, kind: 'permanent' as const, format };
}

// Fisher–Yates with injected samples: domain code never reads a random global.
export function distributePlayers(
  playerIds: readonly string[],
  teamSize: number,
  samples: readonly number[],
): readonly string[][] {
  if (
    !Number.isSafeInteger(teamSize) ||
    teamSize < 1 ||
    teamSize > 32 ||
    playerIds.length < teamSize * 2 ||
    playerIds.length > 256 ||
    playerIds.length % teamSize !== 0 ||
    playerIds.length / teamSize > 32 ||
    new Set(playerIds).size !== playerIds.length ||
    playerIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 128) ||
    samples.length !== playerIds.length - 1 ||
    samples.some((sample) => !Number.isFinite(sample) || sample < 0 || sample >= 1)
  )
    throw new TeamValidationError('distribution');
  const shuffled = [...playerIds];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(samples[shuffled.length - 1 - index]! * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target]!, shuffled[index]!];
  }
  const teams: string[][] = [];
  for (let index = 0; index < shuffled.length; index += teamSize)
    teams.push(shuffled.slice(index, index + teamSize));
  return teams;
}

// Upgrade mutable team profiles only; match snapshots retain their original meaning.
export function makeTeamReusable(team: TeamRecord): TeamRecord {
  if (team.kind !== 'temporary' && !team.assignedMatchId) return team;
  const reusable = { ...team, kind: 'permanent' as const, revision: (team.revision ?? 0) + 1 };
  delete reusable.assignedMatchId;
  if (team.assignedMatchId) delete reusable.archivedAt;
  return reusable;
}

// Preserve old profiles without turning an earlier archive into an irreversible deletion.
export function restoreLegacyTeam(team: TeamRecord): TeamRecord {
  if (team.archivedAt === undefined) return team;
  const restored = { ...team, revision: (team.revision ?? 0) + 1 };
  delete restored.archivedAt;
  return restored;
}
