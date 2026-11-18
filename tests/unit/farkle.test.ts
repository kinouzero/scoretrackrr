import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createFarkleGame,
  farkleScore,
  farkleCanScore,
  farkleVersion,
} from '../../src/lib/domain/games/farkle';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const roll = (ownerId: string, dice: number[], keep = 2 ** dice.length - 1): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { kind: 0, keep, ...Object.fromEntries(dice.map((die, i) => [`d${i + 1}`, die])) },
});
const bank = (ownerId: string): ScoreCommand => ({ type: 'record', ownerId, values: { kind: 1 } });
function setup(target: 5000 | 10000 = 5000, entry: 0 | 500 = 500) {
  return createFarkleGame(farkleVersion(target, entry, '').definition);
}
function apply(game: ReturnType<typeof setup>, state: EngineState, action: ScoreCommand) {
  return game.decide(state, action, config).reduce((s, e) => game.evolve(s, e, config), state);
}
describe('fixed Farkle score and turn rules', () => {
  it.each([
    [[1], 100],
    [[5, 5], 100],
    [[1, 1, 1], 300],
    [[2, 2, 2], 200],
    [[5, 5, 5], 500],
    [[6, 6, 6], 600],
    [[2, 2, 2, 2], 1000],
    [[1, 1, 1, 1, 1], 2000],
    [[6, 6, 6, 6, 6, 6], 3000],
    [[1, 2, 3, 4, 5, 6], 1500],
    [[2, 2, 3, 3, 4, 4], 1500],
    [[2, 2, 2, 2, 6, 6], 1500],
    [[3, 3, 3, 6, 6, 6], 2500],
    [[1, 5, 2], null],
  ] as [number[], number | null][])(
    'scores only complete scoring subsets %j as %s',
    (dice, expected) => {
      expect(farkleScore(dice)).toBe(expected);
      expect(farkleScore([...dice].reverse())).toBe(expected);
    },
  );
  it('detects a bust only when no scoring subset exists', () => {
    expect(farkleCanScore([2, 2, 3, 3, 4, 6])).toBe(false);
    expect(farkleCanScore([2, 2, 3, 3, 4, 4])).toBe(true);
    expect(farkleCanScore([2, 2, 3, 4, 5, 6])).toBe(true);
    expect(() => farkleScore([7])).toThrow('invalid_command');
    expect(() => farkleScore([])).toThrow('invalid_command');
  });
  it('enforces opening threshold, same-roll combinations, remaining dice and hot dice', () => {
    const game = setup();
    let state = game.initialState(config);
    state = apply(game, state, roll('alice', [1, 5, 2, 3, 4, 6], 3));
    expect(game.inspect(state, config)).toMatchObject({ running: 150, remaining: 4, turn: 0 });
    expect(() => apply(game, state, bank('alice'))).toThrow('invalid_command');
    expect(() => apply(game, state, roll('alice', [1, 1, 1, 1, 1, 1]))).toThrow('invalid_command');
    state = apply(game, state, roll('alice', [1, 1, 5, 5]));
    expect(game.inspect(state, config)).toMatchObject({ running: 450, remaining: 6 });
    state = apply(game, state, roll('alice', [1, 2, 3, 4, 5, 6]));
    state = apply(game, state, bank('alice'));
    expect(game.inspect(state, config)).toMatchObject({
      totals: { alice: 1950, bob: 0 },
      running: 0,
      remaining: 6,
      turn: 1,
    });
  });
  it('loses only the pending turn on a genuine bust and never accepts voluntary false busts', () => {
    const game = setup(10000, 0);
    let state = game.initialState(config);
    expect(() => apply(game, state, roll('alice', [1, 2, 3, 4, 5, 6], 0))).toThrow(
      'invalid_command',
    );
    expect(() => apply(game, state, roll('alice', [1, 2, 2, 3, 3, 4], 3))).toThrow(
      'invalid_command',
    );
    state = apply(game, state, roll('alice', [6, 6, 6, 6, 6, 6]));
    state = apply(game, state, bank('alice'));
    state = apply(game, state, roll('bob', [6, 6, 6, 6, 6, 6]));
    state = apply(game, state, roll('bob', [2, 2, 3, 3, 4, 6], 0));
    expect(game.inspect(state, config)).toMatchObject({
      totals: { alice: 3000, bob: 0 },
      running: 0,
      remaining: 6,
      turn: 0,
    });
  });
  it('offers exactly one final turn per other camp, can lose the lead and shares equal winners', () => {
    for (const tie of [false, true]) {
      const game = setup();
      let state = game.initialState(config);
      for (const id of ['alice', 'bob']) {
        state = apply(game, state, roll(id, [6, 6, 6, 6, 6, 6]));
        state = apply(game, state, bank(id));
      }
      state = apply(game, state, roll('alice', [5, 5, 5, 5, 5, 5]));
      state = apply(game, state, bank('alice'));
      expect(game.inspect(state, config)).toMatchObject({ finalTurns: 1, status: 'in_progress' });
      state = apply(game, state, roll('bob', [6, 6, 6, 6, 6, 6]));
      if (!tie) state = apply(game, state, roll('bob', [6, 6, 6, 6, 6, 6]));
      state = apply(game, state, bank('bob'));
      expect(state).toMatchObject({
        status: 'finished',
        winnerIds: tie ? ['alice', 'bob'] : ['bob'],
      });
      expect(() => apply(game, state, roll('alice', [1, 1, 1, 1, 1, 1]))).toThrow('finished');
    }
  });
  it('rejects wrong owners, forged events, definitions and state without mutating inputs', () => {
    const game = setup();
    const state = game.initialState(config);
    expect(() => apply(game, state, roll('bob', [1, 1, 1, 1, 1, 1]))).toThrow('invalid_command');
    const event = game.decide(state, roll('alice', [1, 1, 1, 1, 1, 1]), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 3000 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(() => game.inspect({ ...state, remaining: 0 } as never, config)).toThrow(
      'invalid_state',
    );
    expect(() =>
      createFarkleGame({ ...farkleVersion(5000, 500, '').definition, entry: 99 }),
    ).toThrow('invalid_rules');
    expect(state).toEqual(game.initialState(config));
  });
  it('persists pending risk, banks, corrections and undo with pinned rules after reopen', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'farkle-match',
        versionId: farkleVersion(5000, 0, '').id,
        mode: 'individual',
        playerIds: ['alice', 'lucas'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
      });
      const journal = new MatchJournal(db);
      async function submit(action: Record<string, unknown>) {
        const previous = await journal.read(match.id);
        return journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: previous.projection.lastEventSequence,
          actorPlayerId: 'alice',
          deviceId: 'test-device',
          timestamp,
          action: action as never,
        });
      }
      await submit({ type: 'start' });
      const first = await submit(roll('alice', [6, 6, 6, 6, 6, 6]));
      db.close();
      await db.open();
      expect(gameRunning(await journal.read(match.id))).toBe(3000);
      await submit({
        type: 'correct',
        targetEventId: first.audit.at(-1)!.event.id,
        replacement: roll('alice', [1, 1, 1, 2, 2, 2]),
      });
      const banked = await submit(bank('alice'));
      expect(banked.state.totals.alice).toBe(2500);
      const undone = await submit({ type: 'undo', targetEventId: banked.audit.at(-1)!.event.id });
      expect(undone.state.totals.alice).toBe(0);
      expect(gameRunning(undone)).toBe(2500);
      expect(match.rulesSnapshot).toEqual(farkleVersion(5000, 0, timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
function gameRunning(view: { state: EngineState }) {
  return setup(5000, 0).inspect(view.state, { mode: 'individual', ownerIds: ['alice', 'lucas'] })
    .running;
}
