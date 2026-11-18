import { EngineError, type EngineState } from '../engine/types';
import { copyBoundedJson, immutable, parseConfig } from '../engine/validation';
import type { GameVersionRecord } from '../records';
import { recordedGame } from './recorded';

export const scoreSheets = {
  skyjo: { name: 'Skyjo', max: 8, min: 2, target: 100, lowest: true },
  belote: { name: 'Belote / Coinche', max: 2, min: 2, teams: true },
  tarot: { name: 'Tarot', max: 5, min: 3 },
  rummy: { name: 'Rami', max: 6, min: 2 },
  uno: { name: 'UNO / UNO Flip', max: 10, min: 2, target: 500 },
  scrabble: { name: 'Scrabble', max: 4, min: 2 },
  'seven-wonders': { name: '7 Wonders', max: 7, min: 3, final: true },
  qwixx: { name: 'Qwixx', max: 5, min: 2, final: true },
  clever: { name: 'Très Futé !', max: 4, min: 1, final: true },
  dominoes: { name: 'Dominos', max: 4, min: 2 },
} satisfies Record<
  string,
  {
    name: string;
    max: number;
    min: number;
    target?: number;
    lowest?: boolean;
    teams?: boolean;
    final?: boolean;
  }
>;

export type ScoreSheetId = keyof typeof scoreSheets;
export function isScoreSheet(id: string): id is ScoreSheetId {
  return Object.hasOwn(scoreSheets, id);
}
export function scoreSheetSpec(id: ScoreSheetId): {
  name: string;
  min: number;
  max: number;
  target?: number;
  lowest?: boolean;
  teams?: boolean;
  final?: boolean;
} {
  return scoreSheets[id];
}

export function scoreSheetVersion(id: ScoreSheetId, publishedAt: string): GameVersionRecord {
  return {
    id: `${id}-score-sheet-v1`,
    gameId: id,
    rulesetVersion: 'score-sheet-v1',
    schemaVersion: 1,
    name: scoreSheets[id].name,
    publishedAt,
    definition: {
      schemaVersion: 1,
      id,
      rulesetVersion: 'score-sheet-v1',
      engine: 'score-sheet',
      supportedModes: [scoreSheetSpec(id).teams ? 'teams' : 'individual'],
    },
  };
}

export function skyjoPoints(points: number, lowest: number, closed: boolean) {
  return closed && points > 0 && points >= lowest ? points * 2 : points;
}

export function wondersScience(symbols: readonly number[]) {
  return symbols.reduce((score, count) => score + count ** 2, 0) + 7 * Math.min(...symbols);
}

export function qwixxPoints(rows: readonly number[], penalties: number) {
  return rows.reduce((total, marks) => total + (marks * (marks + 1)) / 2, 0) - penalties * 5;
}

export function cleverPoints(zones: readonly number[], foxes: number) {
  return zones.reduce((total, score) => total + score, 0) + foxes * Math.min(...zones);
}

export function tarotPoints(
  players: number,
  taker: number,
  partner: number,
  cardPoints: number,
  bouts: number,
  multiplier: number,
  bonuses: number,
) {
  const difference = cardPoints - [56, 51, 41, 36][bouts]!;
  const hand = (difference < 0 ? -1 : 1) * (25 + Math.abs(difference)) * multiplier + bonuses;
  return Array.from({ length: players }, (_, index) =>
    index === taker ? hand * (partner >= 0 ? 2 : players - 1) : index === partner ? hand : -hand,
  );
}

export function createScoreSheetGame(id: ScoreSheetId, input: unknown) {
  const version = scoreSheetVersion(id, '');
  if (JSON.stringify(copyBoundedJson(input)) !== JSON.stringify(version.definition))
    throw new EngineError('invalid_rules');
  const spec = scoreSheetSpec(id);
  function validateConfig(value: unknown) {
    const config = parseConfig(value);
    if (
      config.mode !== (spec.teams ? 'teams' : 'individual') ||
      config.ownerIds.length < spec.min ||
      config.ownerIds.length > spec.max
    )
      throw new EngineError('invalid_config');
    return immutable(config);
  }
  const engine = recordedGame<EngineState>({
    id,
    rulesetVersion: version.rulesetVersion,
    lowest: spec.lowest,
    minimumOwners: spec.min,
    initial(input) {
      const config = validateConfig(input);
      return {
        totals: Object.fromEntries(config.ownerIds.map((id) => [id, 0])),
        eventCount: 0,
        status: 'in_progress',
        winnerIds: [],
      };
    },
    check(state, config) {
      validateConfig(config);
      if (Object.keys(state).length !== 4) throw new EngineError('invalid_state');
    },
    reduce(state, action, config) {
      const { round, end } = action.values;
      const points = config.ownerIds.map((_, i) => action.values[`p${i}`]!);
      if (
        action.ownerId !== config.ownerIds[0] ||
        round !== state.eventCount + 1 ||
        (end !== 0 && (end !== 1 || spec.target !== undefined)) ||
        Object.keys(action.values).length !== points.length + 2 ||
        points.some(
          (n) =>
            !Number.isFinite(n) ||
            Math.abs(n) > 10000 ||
            (id === 'tarot' ? !Number.isInteger(n * 2) : !Number.isInteger(n)),
        ) ||
        (id === 'tarot' && points.reduce((a, b) => a + b, 0) !== 0) ||
        (id === 'uno' && (points.some((n) => n < 0) || points.filter((n) => n > 0).length > 1))
      )
        throw new EngineError('invalid_command');
      const totals = Object.fromEntries(
        config.ownerIds.map((id, i) => [id, state.totals[id]! + points[i]!]),
      );
      const best = (spec.lowest ? Math.min : Math.max)(...Object.values(totals));
      const finished =
        !!spec.final ||
        end === 1 ||
        (spec.target !== undefined && Math.max(...Object.values(totals)) >= spec.target);
      return {
        totals,
        eventCount: round,
        status: finished ? 'finished' : 'in_progress',
        winnerIds: finished ? config.ownerIds.filter((id) => totals[id] === best) : [],
      };
    },
  });
  return Object.freeze({
    ...engine,
    validateConfig,
    definition: immutable(version.definition) as typeof version.definition & {
      schemaVersion: 1;
      supportedModes: readonly ('teams' | 'individual')[];
    },
  });
}
