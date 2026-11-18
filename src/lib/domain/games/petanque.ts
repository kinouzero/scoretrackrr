import type { GameVersionRecord, JsonObject, MatchRecord, TeamSnapshot } from '../records';
import type { ScoreCommand } from '../engine/types';
import { EngineError } from '../engine/types';
import type { AuditEntry } from '../journal';
import { scoreSlots, type ScoreSlot } from '../score-slots';

export type PetanqueEnd =
  | { readonly type: 'points'; readonly teamId: string; readonly points: number }
  | { readonly type: 'void' }
  | { readonly type: 'dead_jack'; readonly remaining: readonly [number, number] };
export type EndCommand = Extract<ScoreCommand, { type: 'record' }>;

export function petanqueVersion(
  target: 11 | 13,
  publishedAt: string,
  mode: 'individual' | 'teams',
): GameVersionRecord {
  const rulesetVersion = `free-${mode}-${target}-v1`;
  const definition: JsonObject = {
    schemaVersion: 1,
    id: 'petanque',
    rulesetVersion,
    supportedModes: [mode],
    fields: [
      { id: 'points', minimum: 0, maximum: 96, integer: true },
      { id: 'kind', minimum: 0, maximum: 2, integer: true },
      { id: 'remainingFirst', minimum: 0, maximum: 96, integer: true },
      { id: 'remainingSecond', minimum: 0, maximum: 96, integer: true },
    ],
    score: { op: 'input', field: 'points' },
    initialScore: 0,
    objective: { direction: 'highest', target },
    ties: 'continue',
  };
  return {
    id: `petanque-${rulesetVersion}`,
    gameId: 'petanque',
    rulesetVersion,
    schemaVersion: 1,
    definition,
    publishedAt,
  };
}

// Built-in rule versions are fixed, rather than customizable definitions bearing a trusted ID.
export function assertPetanqueMatch(match: MatchRecord): void {
  const target = match.settingsSnapshot.target;
  if (
    (target !== 11 && target !== 13) ||
    (match.mode !== 'individual' && match.mode !== 'teams') ||
    (match.settingsSnapshot.boulesPerPlayer !== 2 && match.settingsSnapshot.boulesPerPlayer !== 3)
  )
    throw new EngineError('invalid_config');
  const expected = petanqueVersion(target, match.rulesSnapshot.publishedAt, match.mode);
  if (
    match.gameVersionId !== expected.id ||
    match.rulesSnapshot.rulesetVersion !== expected.rulesetVersion ||
    JSON.stringify(match.rulesSnapshot.definition) !== JSON.stringify(expected.definition)
  )
    throw new EngineError('invalid_rules');
  const teams = petanqueSides(match);
  const players = match.playersSnapshot.map((player) => player.id);
  if (
    teams.length < 2 ||
    teams.length > 16 ||
    players.length > 256 ||
    new Set(players).size !== players.length ||
    teams.some((team) => team.playerIds.length < 1 || team.playerIds.length > 32) ||
    new Set(teams.flatMap((team) => team.playerIds)).size !== players.length ||
    teams.some((team) => team.playerIds.some((id) => !players.includes(id))) ||
    !teams.some((team) => team.id === match.settingsSnapshot.firstThrowOwnerId)
  )
    throw new EngineError('invalid_config');
}

export function petanqueSides(match: MatchRecord): readonly TeamSnapshot[] {
  return match.mode === 'teams'
    ? match.teamsSnapshot
    : match.playersSnapshot.map((player) => ({
        id: player.id,
        name: player.displayName,
        color: player.color,
        playerIds: [player.id],
      }));
}

export function petanqueCommand(
  end: PetanqueEnd,
  sides: readonly TeamSnapshot[],
  boulesPerPlayer: number,
): EndCommand {
  const teamIds = sides.map((side) => side.id);
  if (
    teamIds.length < 2 ||
    teamIds.length > 16 ||
    new Set(teamIds).size !== teamIds.length ||
    (boulesPerPlayer !== 2 && boulesPerPlayer !== 3)
  )
    throw new EngineError('invalid_config');
  let ownerId = teamIds[0]!;
  let points = 0;
  let kind = 0;
  let remainingFirst = 0;
  let remainingSecond = 0;
  if (end.type === 'points') {
    if (
      !teamIds.includes(end.teamId) ||
      !Number.isInteger(end.points) ||
      end.points < 1 ||
      end.points >
        (sides.find((side) => side.id === end.teamId)?.playerIds.length ?? 0) * boulesPerPlayer
    )
      throw new EngineError('invalid_command');
    ownerId = end.teamId;
    points = end.points;
  } else if (end.type === 'void') kind = 1;
  else if (end.type === 'dead_jack') {
    if (
      sides.length !== 2 ||
      !Array.isArray(end.remaining) ||
      end.remaining.length !== 2 ||
      end.remaining.some(
        (value, index) =>
          !Number.isInteger(value) ||
          value < 0 ||
          value > sides[index]!.playerIds.length * boulesPerPlayer,
      )
    )
      throw new EngineError('invalid_command');
    kind = 2;
    [remainingFirst, remainingSecond] = end.remaining;
    // FIPJP article 14: points only if exactly one team has unplayed boules.
    if (remainingFirst > 0 !== remainingSecond > 0) {
      points = remainingFirst || remainingSecond;
      ownerId = remainingFirst > 0 ? teamIds[0]! : teamIds[1]!;
    }
  } else throw new EngineError('invalid_command');
  return { type: 'record', ownerId, values: { points, kind, remainingFirst, remainingSecond } };
}

export function validatePetanqueCommand(match: MatchRecord, command: ScoreCommand): void {
  if (command.type !== 'record') throw new EngineError('invalid_command');
  const { points, kind, remainingFirst, remainingSecond } = command.values;
  const end: PetanqueEnd =
    kind === 0
      ? { type: 'points', teamId: command.ownerId, points: points! }
      : kind === 1
        ? { type: 'void' }
        : kind === 2
          ? { type: 'dead_jack', remaining: [remainingFirst!, remainingSecond!] }
          : (() => {
              throw new EngineError('invalid_command');
            })();
  const expected = petanqueCommand(
    end,
    petanqueSides(match),
    match.settingsSnapshot.boulesPerPlayer as number,
  );
  if (
    command.ownerId !== expected.ownerId ||
    Object.keys(command.values).length !== 4 ||
    Object.entries(expected.values).some(([key, value]) => command.values[key] !== value)
  )
    throw new EngineError('invalid_command');
}

export type PetanqueEndSlot = ScoreSlot;
export function petanqueProgress(match: MatchRecord, audit: readonly AuditEntry[]) {
  const slots = scoreSlots(audit);
  const active = slots.filter((slot) => slot.command !== null);
  let nextThrowOwnerId = match.settingsSnapshot.firstThrowOwnerId as string;
  for (const slot of active)
    if (slot.command!.values.points! > 0) nextThrowOwnerId = slot.command!.ownerId;
  return { slots, active, nextThrowOwnerId };
}
