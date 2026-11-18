import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { combination421, createFour21Game, four21Version } from '../../src/lib/domain/games/four21';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const game = createFour21Game(four21Version('').definition);
const roll = (ownerId: string, dice = [4, 2, 1], throws = 1): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { d1: dice[0]!, d2: dice[1]!, d3: dice[2]!, throws },
});
function apply(state: EngineState, action: ScoreCommand) {
  return game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
}
describe('421 Charge 21 explicit variant', () => {
  it.each([
    [[4, 2, 1], 10],
    [[1, 1, 1], 7],
    [[6, 1, 1], 6],
    [[6, 6, 6], 6],
    [[5, 1, 1], 5],
    [[5, 5, 5], 5],
    [[3, 2, 1], 2],
    [[2, 2, 1], 2],
    [[6, 5, 2], 1],
  ] as const)('scores %j as %i tokens', (dice, tokens) => {
    expect(combination421(dice).tokens).toBe(tokens);
  });
  it('ranks all 216 physical dice outcomes independently of dice order', () => {
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++)
        for (let c = 1; c <= 6; c++)
          expect(combination421([a, b, c])).toEqual(combination421([c, a, b]));
    expect(combination421([6, 1, 1]).rank).toBeGreaterThan(combination421([6, 6, 6]).rank);
    expect(combination421([2, 2, 2]).rank).toBeGreaterThan(combination421([6, 5, 4]).rank);
    expect(combination421([3, 2, 1]).rank).toBeGreaterThan(combination421([6, 6, 5]).rank);
  });
  it('conserves 21 tokens, rotates to the loser and automatically switches phases', () => {
    let state = game.initialState(config);
    state = apply(state, roll('alice'));
    state = apply(state, roll('bob', [6, 5, 2]));
    expect(game.inspect(state, config)).toMatchObject({
      pot: 11,
      starter: 1,
      totals: { alice: 0, bob: 10 },
    });
    state = apply(state, roll('bob'));
    state = apply(state, roll('alice', [6, 5, 2]));
    state = apply(state, roll('alice', [6, 5, 2]));
    state = apply(state, roll('bob', [6, 5, 4]));
    expect(game.inspect(state, config)).toMatchObject({
      pot: 0,
      phase: 'discharge',
      starter: 0,
      totals: { alice: 11, bob: 10 },
      winnerIds: [],
    });
    state = apply(state, roll('alice', [4, 2, 1], 3));
    state = apply(state, roll('bob', [6, 5, 2], 2));
    expect(state.totals).toEqual({ alice: 1, bob: 20 });
    state = apply(state, roll('bob', [6, 5, 2]));
    state = apply(state, roll('alice'));
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['alice'],
      totals: { alice: 0, bob: 21 },
    });
    expect(() => apply(state, roll('alice'))).toThrow('finished');
  });
  it('requires an explicit tied-players-only dice tiebreak and rejects forged events', () => {
    let state = apply(game.initialState(config), roll('alice'));
    state = apply(state, roll('bob'));
    expect(game.inspect(state, config).hands).toHaveLength(2);
    expect(() => apply(state, roll('alice'))).toThrow('invalid_command');
    expect(() =>
      apply(state, { type: 'record', ownerId: 'alice', values: { best: 0, worst: 0 } }),
    ).toThrow('invalid_command');
    state = apply(state, { type: 'record', ownerId: 'alice', values: { best: 0, worst: 1 } });
    expect(state.totals.bob).toBe(10);
    const event = game.decide(state, roll('bob'), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 999 } as never, config)).toThrow(
      'invalid_event',
    );
  });
  it('rejects wrong turns, invalid dice, extra input, relaunches during charge and forged state', () => {
    const state = game.initialState(config);
    for (const action of [
      roll('bob'),
      roll('alice', [0, 2, 3]),
      roll('alice', [1.1, 2, 3]),
      roll('alice', [1, 2, 3], 2),
      { type: 'finish' },
      { type: 'record', ownerId: 'alice', values: { d1: 1, d2: 2, d3: 3, throws: 1, points: 9 } },
    ])
      expect(() => apply(state, action as ScoreCommand)).toThrow();
    expect(() => game.inspect({ ...state, pot: 20 } as never, config)).toThrow('invalid_state');
    expect(() => createFour21Game({ ...four21Version('').definition, unknown: true })).toThrow(
      'invalid_rules',
    );
    expect(() => game.validateConfig({ mode: 'cooperative', ownerIds: config.ownerIds })).toThrow(
      'invalid_config',
    );
    expect(state).toEqual(game.initialState(config));
  });
  it('pins the selected variant and replays corrections and undo after database reopen', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'four21-match',
        versionId: four21Version('').id,
        mode: 'individual',
        playerIds: ['alice', 'lucas'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
      });
      const journal = new MatchJournal(db);
      async function submit(action: Record<string, unknown>) {
        const view = await journal.read(match.id);
        return journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: view.projection.lastEventSequence,
          actorPlayerId: 'alice',
          deviceId: 'test-device',
          timestamp,
          action: action as never,
        });
      }
      await submit({ type: 'start' });
      await submit(roll('alice'));
      const entry = await submit(roll('lucas', [6, 5, 2]));
      expect((await journal.read(match.id)).state.totals.lucas).toBe(10);
      await submit({ type: 'undo', targetEventId: entry.audit.at(-1)!.event.id });
      expect((await journal.read(match.id)).state.totals.lucas).toBe(0);
      await submit(roll('lucas', [6, 5, 4]));
      db.close();
      await db.open();
      const replay = await new MatchJournal(db).read(match.id);
      expect(replay.state.totals.lucas).toBe(10);
      expect(match.rulesSnapshot).toEqual(four21Version(timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
