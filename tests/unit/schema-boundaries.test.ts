import { describe, expect, it } from 'vitest';
import {
  validateRules,
  validateConfig,
  validateState,
  validateCommand,
  validateEvent,
} from '../../src/lib/domain/engine/validators.generated.js';

const missing = Symbol('missing');
type Boundary = { label: string; path: string[]; value: unknown };
const field = { id: 'points', minimum: -10, maximum: 100, integer: true };
const constant = { op: 'constant', value: 1 };
const rules = {
  schemaVersion: 1,
  id: 'custom-game',
  rulesetVersion: '1.0',
  supportedModes: ['individual'],
  fields: [field],
  initialScore: 0,
  objective: { direction: 'highest', target: 13 },
  ties: 'shared',
  turns: { rounds: 13, categories: ['points'] },
  score: {
    op: 'if',
    condition: { op: 'gte', left: { op: 'input', field: 'points' }, right: constant },
    then: { op: 'add', left: constant, right: constant },
    else: constant,
  },
};
const boundary = (path: string, value: unknown, label = path): Boundary => ({
  label,
  path: path.split('.'),
  value,
});
function changed(base: unknown, { path, value }: Boundary) {
  const copy = structuredClone(base);
  let cursor = copy as Record<string, unknown>;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string, unknown>;
  const key = path.at(-1)!;
  if (value === missing) delete cursor[key];
  else cursor[key] = value;
  return copy;
}
const required = (keys: string[]) => keys.map((key) => boundary(key, missing, `missing ${key}`));
const range = (path: string, values: unknown[]) =>
  values.map((value, i) => boundary(path, value, `${path} invalid boundary ${i}`));

describe('compiled JSON boundary contracts', () => {
  const config = { mode: 'individual', ownerIds: ['alice', 'bob'] };
  const state = {
    totals: { alice: 0, bob: 0 },
    eventCount: 0,
    status: 'in_progress',
    winnerIds: [],
  };
  const command = { type: 'record', ownerId: 'alice', values: { points: 2 } };
  const event = {
    type: 'score_recorded',
    ownerId: 'alice',
    values: { points: 2 },
    delta: 2,
    gameId: 'custom-game',
    rulesetVersion: '1.0',
  };
  it('accepts supported complete payloads and terminal actions', () => {
    expect(validateRules(rules)).toBe(true);
    expect(validateConfig(config)).toBe(true);
    expect(validateState(state)).toBe(true);
    expect(validateCommand(command)).toBe(true);
    expect(validateCommand({ type: 'finish' })).toBe(true);
    expect(validateEvent(event)).toBe(true);
    expect(
      validateEvent({ type: 'game_finished', gameId: 'custom-game', rulesetVersion: '1.0' }),
    ).toBe(true);
  });

  it.each([
    ...required([
      'schemaVersion',
      'id',
      'rulesetVersion',
      'supportedModes',
      'fields',
      'score',
      'initialScore',
      'objective',
      'ties',
    ]),
    boundary('extra', true),
    boundary('schemaVersion', 2),
    ...range('id', ['', '../game', 42, 'x'.repeat(129)]),
    ...range('rulesetVersion', ['', 'bad version', null, 'x'.repeat(33)]),
    ...range('supportedModes', [
      null,
      [],
      ['unknown'],
      ['individual', 'individual'],
      Array(5).fill('teams'),
    ]),
    ...range('fields', [null, [], Array(25).fill(field), [null]]),
    ...required(['fields.0.id', 'fields.0.minimum', 'fields.0.maximum', 'fields.0.integer']),
    boundary('fields.0.extra', 1),
    ...range('fields.0.id', [3, '', 'A', 'a'.repeat(33)]),
    ...range('fields.0.minimum', [null, -1_000_000_001, 1_000_000_001]),
    ...range('fields.0.maximum', ['1', -1_000_000_001, 1_000_000_001]),
    boundary('fields.0.integer', 'yes'),
    ...range('initialScore', [null, -1_000_000_001, 1_000_000_001]),
    ...range('objective', [
      null,
      {},
      { direction: 'sideways' },
      { direction: 'highest', extra: 1 },
    ]),
    ...range('objective.target', [null, -1_000_000_001, 1_000_000_001]),
    boundary('ties', 'random'),
    ...range('turns', [null, {}, { rounds: 1, extra: 1 }]),
    ...range('turns.rounds', [0, 51, 1.5, '1']),
    ...range('turns.categories', [
      null,
      [],
      Array(51).fill('points'),
      ['bad\nlabel'],
      ['x'.repeat(61)],
      [1],
    ]),
    ...range('score', [
      null,
      { op: 'execute', value: 1 },
      { op: 'constant' },
      { op: 'constant', value: '1' },
      { op: 'constant', value: 1, extra: 1 },
      { op: 'input' },
      { op: 'input', field: 'A' },
      { op: 'input', field: 1 },
      { op: 'input', field: 'points', extra: 1 },
      { op: 'add', left: constant },
      { op: 'add', left: constant, right: constant, extra: 1 },
    ]),
    ...required(['score.condition', 'score.then', 'score.else']),
    boundary('score.extra', 1),
    ...range('score.condition', [
      null,
      {},
      { op: 'eq', left: constant },
      { op: 'eq', left: constant, right: constant, extra: 1 },
    ]),
    boundary('score.condition.op', 'unknown'),
    boundary('score.then.op', 'unknown'),
    boundary('score.else.value', 1_000_000_001),
  ])('rejects malformed rules: $label', (item) => {
    expect(validateRules(changed(rules, item))).toBe(false);
  });

  it.each([
    ...required(['mode', 'ownerIds']),
    boundary('extra', true),
    ...range('mode', [null, 'unknown', 1]),
    ...range('ownerIds', [
      null,
      [],
      Array.from({ length: 65 }, (_, i) => `p${i}`),
      ['alice', 'alice'],
      [''],
      ['bad/id'],
      [1],
    ]),
  ])('rejects malformed owner configuration: $label', (item) => {
    expect(validateConfig(changed(config, item))).toBe(false);
  });

  it.each([
    ...required(['totals', 'eventCount', 'status', 'winnerIds']),
    boundary('extra', true),
    ...range('totals', [
      null,
      {},
      Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, 0])),
      { 'bad/id': 0 },
      { alice: '0' },
      { alice: -1_000_000_000_001 },
      { alice: 1_000_000_000_001 },
    ]),
    ...range('eventCount', [-1, 10001, 1.5, '1']),
    boundary('status', 'unknown'),
    ...range('winnerIds', [
      null,
      ['alice', 'alice'],
      Array.from({ length: 65 }, (_, i) => `p${i}`),
      ['bad/id'],
      [1],
    ]),
  ])('rejects malformed saved state: $label', (item) => {
    expect(validateState(changed(state, item))).toBe(false);
  });

  for (const [name, validate, payload, keys] of [
    ['command', validateCommand, command, ['type', 'ownerId', 'values']],
    [
      'event',
      validateEvent,
      event,
      ['type', 'ownerId', 'values', 'delta', 'gameId', 'rulesetVersion'],
    ],
  ] as const) {
    it.each([
      ...required([...keys]),
      boundary('extra', true),
      boundary('type', 'unknown'),
      ...range('ownerId', ['', 1, 'bad/id']),
      ...range('values', [
        null,
        {},
        Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`p${i}`, 1])),
        { Bad: 1 },
        { points: '1' },
        { points: -1_000_000_001 },
        { points: 1_000_000_001 },
      ]),
      ...(name === 'event'
        ? [
            ...range('delta', ['1', -1_000_000_000_001, 1_000_000_000_001]),
            ...range('gameId', ['', 1, 'bad/id']),
            ...range('rulesetVersion', ['', 1, 'bad version', 'x'.repeat(33)]),
          ]
        : []),
    ])(`rejects malformed ${name}: $label`, (item) => {
      expect(validate(changed(payload, item))).toBe(false);
    });
  }

  it.each([null, [], 1, 'record', false])('rejects nonobject boundary values: %j', (value) => {
    for (const validate of [
      validateRules,
      validateConfig,
      validateState,
      validateCommand,
      validateEvent,
    ])
      expect(validate(value)).toBe(false);
  });
});
