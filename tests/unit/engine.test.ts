import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDeclarativeGame, replayEvents } from '../../src/lib/domain/engine/declarative';
import {
  EngineError,
  type DeclarativeRules,
  type Expression,
  type ScoreEvent,
  type EngineState,
} from '../../src/lib/domain/engine/types';

const constant = (value: number): Expression => ({ op: 'constant', value });
const input = (field = 'points'): Expression => ({ op: 'input', field });
function rules(overrides: Partial<DeclarativeRules> = {}): DeclarativeRules {
  return {
    schemaVersion: 1,
    id: 'test-counter',
    rulesetVersion: '1.0.0',
    supportedModes: ['individual', 'teams'],
    fields: [{ id: 'points', minimum: 0, maximum: 1000, integer: true }],
    score: input(),
    initialScore: 0,
    objective: { direction: 'highest', target: 13 },
    ties: 'shared',
    ...overrides,
  };
}
const config = { mode: 'teams' as const, ownerIds: ['blue', 'red'] };
const record = (ownerId: string, points: number) => ({
  type: 'record' as const,
  ownerId,
  values: { points },
});
function apply(
  game: ReturnType<typeof createDeclarativeGame>,
  state: EngineState,
  ownerId: string,
  points: number,
) {
  const events = game.decide(state, record(ownerId, points), config);
  return {
    state: events.reduce((current, event) => game.evolve(current, event, config), state),
    events,
  };
}

describe('declarative scoring', () => {
  it('scores two owners to the objective and rejects further scoring', () => {
    const game = createDeclarativeGame(rules());
    const initial = game.initialState(config);
    const first = apply(game, initial, 'blue', 4);
    const second = apply(game, first.state, 'red', 2);
    const final = apply(game, second.state, 'blue', 9);
    expect(initial.totals).toEqual({ blue: 0, red: 0 });
    expect(final.state).toEqual({
      totals: { blue: 13, red: 2 },
      eventCount: 3,
      status: 'finished',
      winnerIds: ['blue'],
    });
    expect(game.isFinished(final.state, config)).toBe(true);
    expect(() => game.decide(final.state, record('red', 1), config)).toThrow(
      expect.objectContaining({ code: 'finished' }),
    );
  });
  it('calculates a conditional bonus and subtracts a penalty', () => {
    const game = createDeclarativeGame(
      rules({
        fields: [
          { id: 'base', minimum: 0, maximum: 100, integer: true },
          { id: 'earned', minimum: 0, maximum: 1, integer: true },
          { id: 'penalty', minimum: 0, maximum: 100, integer: true },
        ],
        objective: { direction: 'highest' },
        score: {
          op: 'subtract',
          left: {
            op: 'add',
            left: input('base'),
            right: {
              op: 'if',
              condition: { op: 'eq', left: input('earned'), right: constant(1) },
              then: constant(20),
              else: constant(0),
            },
          },
          right: input('penalty'),
        },
      }),
    );
    const event = game.decide(
      game.initialState(config),
      { type: 'record', ownerId: 'blue', values: { base: 10, earned: 1, penalty: 7 } },
      config,
    )[0]!;
    expect(event).toMatchObject({ delta: 23 });
    expect(game.evolve(game.initialState(config), event, config).totals.blue).toBe(23);
  });
  it.each([
    { op: 'add', expected: 15 },
    { op: 'subtract', expected: 9 },
    { op: 'multiply', expected: 36 },
    { op: 'divide', expected: 4 },
    { op: 'min', expected: 3 },
    { op: 'max', expected: 12 },
  ] as const)('supports allowlisted numeric operation $op', ({ op, expected }) => {
    const game = createDeclarativeGame(
      rules({
        objective: { direction: 'highest' },
        score: { op, left: constant(12), right: constant(3) },
      }),
    );
    expect(apply(game, game.initialState(config), 'blue', 1).state.totals.blue).toBe(expected);
  });
  it.each([
    { op: 'eq', left: 3, right: 3 },
    { op: 'gt', left: 4, right: 3 },
    { op: 'gte', left: 3, right: 3 },
    { op: 'lt', left: 2, right: 3 },
    { op: 'lte', left: 3, right: 3 },
  ] as const)(
    'supports condition $op and evaluates only the chosen branch',
    ({ op, left, right }) => {
      const game = createDeclarativeGame(
        rules({
          objective: { direction: 'highest' },
          score: {
            op: 'if',
            condition: { op, left: constant(left), right: constant(right) },
            then: constant(5),
            else: { op: 'divide', left: constant(1), right: constant(0) },
          },
        }),
      );
      expect(apply(game, game.initialState(config), 'blue', 1).state.totals.blue).toBe(5);
    },
  );
  it('uses the false branch and handles a descending objective', () => {
    const game = createDeclarativeGame(
      rules({
        initialScore: 10,
        objective: { direction: 'lowest', target: 0 },
        score: {
          op: 'if',
          condition: { op: 'gt', left: input(), right: constant(50) },
          then: constant(0),
          else: { op: 'subtract', left: constant(0), right: input() },
        },
      }),
    );
    const state = apply(game, game.initialState(config), 'blue', 10).state;
    expect(state).toMatchObject({
      totals: { blue: 0, red: 10 },
      status: 'finished',
      winnerIds: ['blue'],
    });
    expect(game.getView(state, config).ranking[0]?.ownerId).toBe('blue');
  });
  it('allows explicit shared ties with stable ranking order', () => {
    const game = createDeclarativeGame(rules({ objective: { direction: 'highest' } }));
    let state = apply(game, game.initialState(config), 'blue', 5).state;
    state = apply(game, state, 'red', 5).state;
    const event = game.decide(state, { type: 'finish' }, config)[0]!;
    const final = game.evolve(state, event, config);
    expect(final.winnerIds).toEqual(['blue', 'red']);
    expect(game.getView(final, config).ranking).toEqual([
      { ownerId: 'blue', total: 5, rank: 1 },
      { ownerId: 'red', total: 5, rank: 1 },
    ]);
  });
  it('requires play to continue for unresolved ties and prevents premature closure', () => {
    const game = createDeclarativeGame(
      rules({ objective: { direction: 'highest' }, ties: 'continue' }),
    );
    expect(() => game.decide(game.initialState(config), { type: 'finish' }, config)).toThrow(
      expect.objectContaining({ code: 'empty_game' }),
    );
    let state = apply(game, game.initialState(config), 'blue', 5).state;
    state = apply(game, state, 'red', 5).state;
    expect(() => game.decide(state, { type: 'finish' }, config)).toThrow(
      expect.objectContaining({ code: 'tie' }),
    );
    state = apply(game, state, 'red', 1).state;
    const final = game.evolve(state, game.decide(state, { type: 'finish' }, config)[0]!, config);
    expect(final.winnerIds).toEqual(['red']);
    const targetGame = createDeclarativeGame(rules());
    const short = apply(targetGame, targetGame.initialState(config), 'blue', 1).state;
    expect(() => targetGame.decide(short, { type: 'finish' }, config)).toThrow(
      expect.objectContaining({ code: 'target_not_reached' }),
    );
  });
});

describe('versioned replay and immutability', () => {
  it('replays serialized events identically with independent game instances', () => {
    const original = rules();
    const game = createDeclarativeGame(original);
    let state = game.initialState(config);
    const events: ScoreEvent[] = [];
    for (const [ownerId, points] of [
      ['blue', 4],
      ['red', 2],
      ['blue', 9],
    ] as const) {
      const next = apply(game, state, ownerId, points);
      events.push(...next.events);
      state = next.state;
    }
    const independent = createDeclarativeGame(JSON.parse(JSON.stringify(original)));
    expect(
      replayEvents(
        independent,
        JSON.parse(JSON.stringify(config)),
        JSON.parse(JSON.stringify(events)),
      ),
    ).toEqual(state);
    expect(game.getView(state, config)).toEqual(
      independent.getView(replayEvents(independent, config, events), config),
    );
  });
  it('freezes returned data without freezing or retaining caller-owned rules/config', () => {
    const original = JSON.parse(JSON.stringify(rules()));
    const owners = { ...config, ownerIds: ['blue', 'red'] };
    const game = createDeclarativeGame(original);
    const frozenConfig = game.validateConfig(owners);
    original.initialScore = 100;
    owners.ownerIds.push('third');
    const initial = game.initialState(frozenConfig);
    expect(initial.totals).toEqual({ blue: 0, red: 0 });
    const events = game.decide(initial, record('blue', 4), frozenConfig);
    expect(Object.isFrozen(game.definition.score)).toBe(true);
    expect(Object.isFrozen(initial.totals)).toBe(true);
    expect(Object.isFrozen(events)).toBe(true);
    expect(Object.isFrozen(events[0])).toBe(true);
    expect(() => Object.assign(initial.totals, { blue: 999 })).toThrow(TypeError);
  });
  it('rejects forged deltas and events from another rules version', () => {
    const game = createDeclarativeGame(rules());
    const initial = game.initialState(config);
    const event = game.decide(initial, record('blue', 4), config)[0]!;
    expect(() => game.evolve(initial, { ...event, delta: 999 } as ScoreEvent, config)).toThrow(
      expect.objectContaining({ code: 'invalid_event' }),
    );
    const newer = createDeclarativeGame(rules({ rulesetVersion: '2.0.0' }));
    expect(() => newer.evolve(newer.initialState(config), event, config)).toThrow(
      expect.objectContaining({ code: 'invalid_event' }),
    );
    expect(game.definition.rulesetVersion).toBe('1.0.0');
  });
});

describe('untrusted input boundaries', () => {
  it('accepts bounded shared subexpressions but rejects an oversized expression tree', () => {
    function tree(level: number): Expression {
      if (level === 0) return constant(1);
      const child = tree(level - 1);
      return { op: 'add', left: child, right: child };
    }
    const game = createDeclarativeGame(
      rules({ objective: { direction: 'highest' }, score: tree(6) }),
    );
    expect(apply(game, game.initialState(config), 'blue', 0).state.totals.blue).toBe(64);
    expect(() => createDeclarativeGame(rules({ score: tree(7) }))).toThrow(
      expect.objectContaining({ code: 'input_limit' }),
    );
  });
  it('rejects total overflow before emitting an otherwise valid delta', () => {
    const game = createDeclarativeGame(rules({ objective: { direction: 'highest' } }));
    const state: EngineState = {
      totals: { blue: 1_000_000_000_000, red: 0 },
      eventCount: 1000,
      status: 'in_progress',
      winnerIds: [],
    };
    expect(() => game.decide(state, record('blue', 1), config)).toThrow(
      expect.objectContaining({ code: 'arithmetic' }),
    );
    expect(state.totals.blue).toBe(1_000_000_000_000);
  });
  it.each([
    { score: 'globalThis.fetch("https://example.com")' },
    { score: { op: 'eval', code: '1+1' } },
    { score: { op: 'import', module: 'https://example.com/game.js' } },
    { schemaVersion: 2 },
    { script: 'return 5' },
    { fields: [{ id: 'points', minimum: 5, maximum: 1, integer: true }] },
    { fields: [{ id: 'other', minimum: 0, maximum: 10, integer: true }] },
    {
      fields: [
        { id: 'points', minimum: 0, maximum: 10, integer: true },
        { id: 'points', minimum: 0, maximum: 10, integer: true },
      ],
    },
    { initialScore: 13 },
  ])('rejects unsupported rule definitions', (overrides) => {
    expect(() => createDeclarativeGame({ ...rules(), ...overrides })).toThrow(EngineError);
  });
  it('rejects cycles, deep/oversized data and accessors before schema traversal', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => createDeclarativeGame(cyclic)).toThrow(
      expect.objectContaining({ code: 'input_limit' }),
    );
    let expression: Expression = constant(1);
    for (let index = 0; index < 14; index++)
      expression = { op: 'add', left: expression, right: constant(1) };
    expect(() => createDeclarativeGame(rules({ score: expression }))).toThrow(
      expect.objectContaining({ code: 'input_limit' }),
    );
    expect(() => createDeclarativeGame({ ...rules(), oversized: 'a'.repeat(2049) })).toThrow(
      expect.objectContaining({ code: 'input_limit' }),
    );
    let touched = false;
    const accessor = Object.defineProperty({}, 'id', {
      enumerable: true,
      get() {
        touched = true;
        return 'bad';
      },
    });
    expect(() => createDeclarativeGame(accessor)).toThrow(EngineError);
    expect(touched).toBe(false);
    const pollution = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => createDeclarativeGame(pollution)).toThrow(EngineError);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
  it.each([
    { type: 'record', ownerId: 'missing', values: { points: 4 } },
    { type: 'record', ownerId: 'blue', values: { points: -1 } },
    { type: 'record', ownerId: 'blue', values: { points: 1001 } },
    { type: 'record', ownerId: 'blue', values: { points: 1.5 } },
    { type: 'record', ownerId: 'blue', values: { points: '4' } },
    { type: 'record', ownerId: 'blue', values: { points: 4, extra: 1 } },
    { type: 'record', ownerId: 'blue', values: {} },
    { type: 'record', ownerId: 'blue', values: { points: Infinity } },
  ])('rejects invalid score commands without mutating input', (command) => {
    const game = createDeclarativeGame(rules());
    const initial = game.initialState(config);
    expect(() => game.validateAction(initial, command, config)).toThrow(EngineError);
    expect(initial.eventCount).toBe(0);
    if (typeof command.values.points === 'string') expect(command.values.points).toBe('4');
  });
  it('rejects unknown modes, duplicate owners and prototype-derived identifiers', () => {
    const game = createDeclarativeGame(rules());
    for (const input of [
      { mode: 'cooperative', ownerIds: ['blue'] },
      { ...config, ownerIds: ['blue', 'blue'] },
      { ...config, ownerIds: ['constructor'] },
    ])
      expect(() => game.validateConfig(input)).toThrow(EngineError);
  });
  it('rejects unsafe arithmetic before any event is emitted', () => {
    for (const score of [
      { op: 'divide', left: constant(1), right: constant(0) },
      { op: 'multiply', left: constant(1_000_000_000), right: constant(1_000_000_000) },
    ] as Expression[]) {
      const game = createDeclarativeGame(rules({ score }));
      expect(() => game.decide(game.initialState(config), record('blue', 1), config)).toThrow(
        expect.objectContaining({ code: 'arithmetic' }),
      );
    }
  });
  it('rejects inconsistent state and excessive replays', () => {
    const game = createDeclarativeGame(rules());
    const initial = game.initialState(config);
    expect(() => game.getView({ ...initial, totals: { blue: 999, red: 0 } }, config)).toThrow(
      expect.objectContaining({ code: 'invalid_state' }),
    );
    expect(() => game.getView({ ...initial, totals: { blue: 0, foreign: 0 } }, config)).toThrow(
      EngineError,
    );
    expect(() => game.getView({ ...initial, winnerIds: ['blue'] }, config)).toThrow(EngineError);
    expect(() => replayEvents(game, config, new Array(10_001))).toThrow(
      expect.objectContaining({ code: 'input_limit' }),
    );
  });
  it('runs static validators with runtime string-code generation disabled', () => {
    const source = readFileSync('src/lib/domain/engine/validators.generated.js', 'utf8').replace(
      /\bexport\s+(const|function)\s/g,
      '$1 ',
    );
    const context = vm.createContext(
      { sample: rules() },
      { codeGeneration: { strings: false, wasm: false } },
    );
    vm.runInContext(source, context);
    expect(vm.runInContext('validateRules(sample)', context)).toBe(true);
  });
});
