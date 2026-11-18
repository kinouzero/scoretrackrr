import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createCricketGame, cricketVersion } from '../../src/lib/domain/games/cricket';
import type { EngineConfig, EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const dart = (ownerId: string, sector: number, multiplier = 1): ScoreCommand => ({
  type: 'record',
  ownerId,
  values: { sector, multiplier },
});
function setup(points = true) {
  return createCricketGame(cricketVersion(points, '').definition);
}
function apply(
  game: ReturnType<typeof setup>,
  state: EngineState,
  action: ScoreCommand,
  settings: EngineConfig = config,
) {
  return game.decide(state, action, settings).reduce((s, e) => game.evolve(s, e, settings), state);
}
function misses(game: ReturnType<typeof setup>, state: EngineState, ownerId = 'bob') {
  for (let i = 0; i < 3; i++) state = apply(game, state, dart(ownerId, 0));
  return state;
}
describe('Cricket classic and no-score variants', () => {
  it('closes targets with three marks and scores only the excess portion of an impact', () => {
    const game = setup();
    let state = game.initialState(config);
    state = apply(game, state, dart('alice', 20));
    state = apply(game, state, dart('alice', 20, 3));
    expect(game.inspect(state, config)).toMatchObject({
      marks: { alice: [3, 0, 0, 0, 0, 0, 0] },
      totals: { alice: 20, bob: 0 },
      dartsUsed: 2,
    });
    state = apply(game, state, dart('alice', 25, 2));
    expect(game.inspect(state, config).marks.alice![6]).toBe(2);
  });
  it('keeps a closed target scoreless after all opponents close it', () => {
    const game = setup();
    let state = game.initialState(config);
    state = apply(game, state, dart('alice', 20, 3));
    state = apply(game, state, dart('alice', 20, 3));
    state = apply(game, state, dart('alice', 1, 3));
    expect(state.totals.alice).toBe(60);
    state = apply(game, state, dart('bob', 20, 3));
    state = apply(game, state, dart('bob', 20, 3));
    expect(state.totals.bob).toBe(0);
    state = apply(game, state, dart('bob', 0));
    state = apply(game, state, dart('alice', 20, 3));
    expect(state.totals.alice).toBe(60);
  });
  it('requires closure and at least an equal score; a tied total awards the first closure winner', () => {
    const game = setup();
    let state = game.initialState(config);
    state = apply(game, state, dart('alice', 19, 3));
    state = apply(game, state, dart('alice', 0));
    state = apply(game, state, dart('alice', 0));
    state = apply(game, state, dart('bob', 20, 3));
    state = apply(game, state, dart('bob', 20, 3));
    state = apply(game, state, dart('bob', 0));
    for (const sector of [20, 18, 17]) state = apply(game, state, dart('alice', sector, 3));
    state = misses(game, state);
    state = apply(game, state, dart('alice', 16, 3));
    state = apply(game, state, dart('alice', 15, 3));
    state = apply(game, state, dart('alice', 25, 2));
    state = misses(game, state);
    state = apply(game, state, dart('alice', 25));
    expect(state.status).toBe('in_progress');
    expect(game.inspect(state, config).marks.alice).toEqual([3, 3, 3, 3, 3, 3, 3]);
    state = apply(game, state, dart('alice', 15, 2));
    expect(state.totals.alice).toBe(30);
    state = apply(game, state, dart('alice', 15, 2));
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['alice'],
      totals: { alice: 60, bob: 60 },
    });
  });
  it('plays no-score without awarding excess points and finishes immediately on the final bull', () => {
    const game = setup(false);
    let state = game.initialState(config);
    for (const targets of [
      [20, 20, 19],
      [18, 17, 16],
    ]) {
      for (const sector of targets) state = apply(game, state, dart('alice', sector, 3));
      state = misses(game, state);
    }
    state = apply(game, state, dart('alice', 15, 3));
    state = apply(game, state, dart('alice', 25, 2));
    state = apply(game, state, dart('alice', 25));
    expect(state).toMatchObject({
      status: 'finished',
      winnerIds: ['alice'],
      totals: { alice: 0, bob: 0 },
    });
    expect(() => apply(game, state, dart('alice', 0))).toThrow('finished');
  });
  it('continues to award points while any of three camps has an open target', () => {
    const game = setup();
    const three = { mode: 'teams' as const, ownerIds: ['alice', 'bob', 'chris'] };
    let state = game.initialState(three);
    for (const [id, sectors] of [
      ['alice', [20, 0, 0]],
      ['bob', [20, 0, 0]],
      ['chris', [0, 0, 0]],
      ['alice', [20]],
    ] as [string, number[]][])
      for (const sector of sectors)
        state = apply(game, state, dart(id, sector, sector ? 3 : 1), three);
    expect(state.totals.alice).toBe(60);
  });
  it('rejects invalid bull, wrong turn, forged marks, rule changes and forged event deltas', () => {
    const game = setup();
    const state = game.initialState(config);
    expect(() => apply(game, state, dart('alice', 25, 3))).toThrow('invalid_command');
    expect(() => apply(game, state, dart('bob', 20))).toThrow('invalid_command');
    const event = game.decide(state, dart('alice', 20), config)[0]!;
    expect(() => game.evolve(state, { ...event, delta: 20 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(() =>
      game.inspect(
        { ...state, marks: { alice: [4, 0, 0, 0, 0, 0, 0], bob: [0, 0, 0, 0, 0, 0, 0] } } as never,
        config,
      ),
    ).toThrow('invalid_state');
    expect(() =>
      createCricketGame({ ...cricketVersion(true, '').definition, code: 'run' }),
    ).toThrow('invalid_rules');
    expect(state).toEqual(game.initialState(config));
  });
  it('publishes both variants and replays mark/point corrections and reversal after reopen', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      const catalog = new CatalogRepository(db);
      await catalog.initialize(timestamp);
      expect((await catalog.list({ search: 'Darts' })).items[0]!.versions).toHaveLength(6);
      const match = await new DeclarativeRepository(db).create({
        id: 'cricket-match',
        versionId: cricketVersion(true, '').id,
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
      await submit(dart('alice', 20, 3));
      const first = await submit(dart('alice', 20, 3));
      expect(first.state.totals.alice).toBe(60);
      const corrected = await submit({
        type: 'correct',
        targetEventId: first.audit.at(-1)!.event.id,
        replacement: dart('alice', 20, 2),
      });
      expect(corrected.state.totals.alice).toBe(40);
      await submit({ type: 'undo', targetEventId: corrected.audit.at(-1)!.event.id });
      db.close();
      await db.open();
      expect((await journal.read(match.id)).state.totals.alice).toBe(0);
      expect(match.rulesSnapshot).toEqual(cricketVersion(true, timestamp));
    } finally {
      db.close();
      await db.delete();
    }
  });
});
