import { parseRules } from '../engine/validation';

export interface CounterSettings {
  readonly minimum: number;
  readonly maximum: number;
  readonly initialScore: number;
  readonly target?: number;
  readonly direction: 'highest' | 'lowest';
}
export function counterDefinition(id: string, rulesetVersion: string, settings: CounterSettings) {
  return parseRules({
    schemaVersion: 1,
    id,
    rulesetVersion,
    supportedModes: ['individual', 'teams', 'cooperative', 'mixed'],
    fields: [{ id: 'points', minimum: settings.minimum, maximum: settings.maximum, integer: true }],
    score: { op: 'input', field: 'points' },
    initialScore: settings.initialScore,
    objective: {
      direction: settings.direction,
      ...(settings.target === undefined ? {} : { target: settings.target }),
    },
    ties: 'shared',
  });
}
