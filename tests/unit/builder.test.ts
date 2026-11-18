import { describe, expect, it } from 'vitest';
import { builderDefinition, readBuilder } from '../../src/lib/domain/games/builder';
import { createDeclarativeGame } from '../../src/lib/domain/engine/declarative';
import { counterDefinition } from '../../src/lib/domain/games/counter';
const settings = {
  minimum: 0,
  maximum: 100,
  initialScore: 0,
  direction: 'highest' as const,
  target: 100,
  fields: [
    { id: 'points', minimum: 0, maximum: 100, weight: 2 },
    { id: 'penalty', minimum: 0, maximum: 10, weight: -3 },
  ],
  bonus: { field: 'points', threshold: 10, points: 5 },
};
describe('no-code weighted field builder', () => {
  it('scores field coefficients and a threshold bonus through the trusted engine', () => {
    const rules = builderDefinition('builder', '1', settings);
    const game = createDeclarativeGame(rules);
    const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
    let state = game.initialState(config);
    state = game
      .decide(
        state,
        { type: 'record', ownerId: 'alice', values: { points: 10, penalty: 2 } },
        config,
      )
      .reduce((s, e) => game.evolve(s, e, config), state);
    expect(state.totals.alice).toBe(19);
  });
  it('reopens generated weighted settings and legacy counters without losing formula information', () => {
    const rules = builderDefinition('builder', '1', settings);
    const read = readBuilder(rules);
    expect(builderDefinition('builder', '1', read)).toEqual(rules);
    expect(readBuilder(counterDefinition('legacy', '1', settings)).fields).toEqual([
      { id: 'points', minimum: 0, maximum: 100, weight: 1 },
    ]);
  });
  it('rejects invalid identifiers, duplicate fields, out-of-bound weights and unknown bonus fields', () => {
    for (const fields of [
      [],
      Array.from({ length: 9 }, (_, i) => ({
        id: `field${i}`,
        minimum: 0,
        maximum: 10,
        weight: 1,
      })),
      [{ id: 'bad id', minimum: 0, maximum: 10, weight: 1 }],
      [settings.fields[0]!, settings.fields[0]!],
      [{ ...settings.fields[0]!, weight: 1001 }],
    ])
      expect(() => builderDefinition('builder', '1', { ...settings, fields })).toThrow();
    expect(() =>
      builderDefinition('builder', '1', {
        ...settings,
        bonus: { field: 'missing', threshold: 1, points: 1 },
      }),
    ).toThrow();
  });
});

describe('ordered custom rounds and named categories', () => {
  const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob', 'carol'] };
  function scheduled(target?: number, direction: 'highest' | 'lowest' = 'highest') {
    return builderDefinition('rounds', '1', {
      ...settings,
      target,
      initialScore: direction === 'highest' ? 0 : 100,
      direction,
      turns: { rounds: 2, categories: ['Opening', 'Final'] },
    });
  }
  it('enforces complete ordered rounds, ends at the configured limit and reopens settings losslessly', () => {
    const rules = scheduled();
    expect(builderDefinition('rounds', '1', readBuilder(rules))).toEqual(rules);
    const game = createDeclarativeGame(rules);
    let state = game.initialState(config);
    const record = (ownerId: string, points: number) => {
      const command = { type: 'record' as const, ownerId, values: { points, penalty: 0 } };
      state = game
        .decide(state, command, config)
        .reduce((s, e) => game.evolve(s, e, config), state);
    };
    expect(() => record('bob', 1)).toThrow('invalid_command');
    record('alice', 2);
    expect(() => record('alice', 3)).toThrow('invalid_command');
    expect(() => game.decide(state, { type: 'finish' }, config)).toThrow('invalid_command');
    record('bob', 1);
    record('carol', 0);
    expect(state.status).toBe('in_progress');
    record('alice', 0);
    record('bob', 0);
    record('carol', 4);
    expect(state).toMatchObject({ status: 'finished', winnerIds: ['carol'], eventCount: 6 });
    expect(() => record('alice', 0)).toThrow('finished');
    expect(() => game.getView({ ...state, eventCount: 7 }, config)).toThrow('invalid_state');
  });
  it('checks targets only after everyone has played and shares tied final victories', () => {
    for (const direction of ['highest', 'lowest'] as const) {
      const game = createDeclarativeGame(scheduled(direction === 'highest' ? 10 : 90, direction));
      let state = game.initialState(config);
      for (const ownerId of config.ownerIds) {
        const command = {
          type: 'record' as const,
          ownerId,
          values: {
            points: direction === 'highest' ? 10 : 0,
            penalty: direction === 'highest' ? 0 : 4,
          },
        };
        state = game
          .decide(state, command, config)
          .reduce((s, e) => game.evolve(s, e, config), state);
        expect(state.status).toBe(ownerId === 'carol' ? 'finished' : 'in_progress');
      }
      expect(state.winnerIds).toEqual(config.ownerIds);
    }
  });
  it('rejects malformed schedules, misleading category labels and configurations exceeding the journal budget', () => {
    for (const turns of [
      { rounds: 0 },
      { rounds: 51 },
      { rounds: 1.5 },
      { rounds: 2, categories: ['Only one'] },
      { rounds: 1, categories: [''] },
      { rounds: 1, categories: [' padded '] },
      { rounds: 1, categories: ['hidden\nline'] },
      { rounds: 1, categories: ['a'.repeat(61)] },
    ])
      expect(() => builderDefinition('rounds', '1', { ...settings, turns })).toThrow();
    expect(() => createDeclarativeGame({ ...scheduled(), ties: 'continue' })).toThrow();
    const game = createDeclarativeGame({ ...scheduled(), turns: { rounds: 50 } });
    expect(() =>
      game.validateConfig({
        mode: 'teams',
        ownerIds: Array.from({ length: 19 }, (_, i) => `team-${i}`),
      }),
    ).toThrow('invalid_config');
  });
});
