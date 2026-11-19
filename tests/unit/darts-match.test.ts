import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createDartsMatchGame,
  type DartsMatchOptions,
} from '../../src/lib/domain/games/darts-match';
import { x01Version } from '../../src/lib/domain/games/darts';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { createGame } from '../../src/lib/domain/games/engine';
import type { EngineConfig, EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
const options: DartsMatchOptions = {
  legsToWin: 3,
  startingRule: 'alternate',
  firstStarterId: 'alice',
};
const next = (id: string): ScoreCommand => ({
  type: 'record',
  ownerId: id,
  values: { nextLeg: 1 },
});
function setup(overrides: Partial<DartsMatchOptions> = {}) {
  return createDartsMatchGame(x01Version(301, false, '').definition, { ...options, ...overrides });
}
function apply(
  game: ReturnType<typeof setup>,
  state: EngineState,
  action: ScoreCommand,
  cfg: EngineConfig = config,
) {
  return game.decide(state, action, cfg).reduce((s, e) => game.evolve(s, e, cfg), state);
}
function winLeg(
  game: ReturnType<typeof setup>,
  state: EngineState,
  winner: string,
  cfg: EngineConfig = config,
) {
  for (let i = 0; i < 20 && game.inspect(state, cfg).legState.status !== 'finished'; i++) {
    const leg = game.inspect(state, cfg).legState as EngineState & { turn: number };
    const id = game.getLegConfig(state, cfg).ownerIds[leg.turn]!;
    state = apply(
      game,
      state,
      {
        type: 'record',
        ownerId: id,
        values: { total: id === winner ? (leg.totals[id] === 301 ? 180 : 121) : 0, checkout: 0 },
      },
      cfg,
    );
  }
  expect(game.inspect(state, cfg).legState.status).toBe('finished');
  return state;
}
describe('pinned multi-leg darts matches', () => {
  it.each(['alternate', 'loser'] as const)(
    'counts wins and applies %s starting order rather than winner order',
    (startingRule) => {
      const game = setup({ startingRule });
      let state = game.initialState(config);
      state = winLeg(game, state, 'alice');
      expect(state.status).toBe('in_progress');
      expect(game.getProgress(state, config)).toMatchObject({
        wins: { alice: 1, bob: 0 },
        nextStarterId: 'bob',
      });
      expect(() => apply(game, state, next('alice'))).toThrow('invalid_command');
      state = apply(game, state, next('bob'));
      expect(state.totals).toEqual({ bob: 301, alice: 301 });
      state = winLeg(game, state, 'alice');
      const starter = startingRule === 'alternate' ? 'alice' : 'bob';
      expect(game.getProgress(state, config).nextStarterId).toBe(starter);
      state = apply(game, state, next(starter));
      state = winLeg(game, state, 'alice');
      expect(state).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
      expect(game.getProgress(state, config).wins).toEqual({ alice: 3, bob: 0 });
      expect(() => apply(game, state, next('bob'))).toThrow('finished');
    },
  );
  it('keeps double-out rules and per-dart visits across leg resets', () => {
    const game = createDartsMatchGame(x01Version(301, true, '').definition, {
      ...options,
      legsToWin: 2,
    });
    let state = game.initialState(config);
    for (const [ownerId, total, checkout] of [
      ['alice', 180, 0],
      ['bob', 0, 0],
      ['alice', 121, 1],
    ] as const)
      state = apply(game, state, { type: 'record', ownerId, values: { total, checkout } });
    expect(game.getProgress(state, config)).toMatchObject({
      wins: { alice: 1, bob: 0 },
      nextStarterId: 'bob',
    });
    state = apply(game, state, next('bob'));
    state = apply(game, state, {
      type: 'record',
      ownerId: 'bob',
      values: { sector: 20, multiplier: 3 },
    });
    expect(game.inspect(state, config).legState).toMatchObject({
      totals: { alice: 301, bob: 241 },
      dartsUsed: 1,
      visitStart: 301,
    });
  });
  it.each(['alternate', 'loser'] as const)(
    'resets legs after a set, preserves %s starters and ends on the decisive set',
    (startingRule) => {
      const game = setup({ legsToWin: 2, setsToWin: 2, startingRule });
      let state = game.initialState(config);
      state = winLeg(game, state, 'alice');
      state = apply(game, state, next('bob'));
      state = winLeg(game, state, 'alice');
      const starter = startingRule === 'alternate' ? 'alice' : 'bob';
      expect(state.status).toBe('in_progress');
      expect(game.getProgress(state, config)).toMatchObject({
        number: 2,
        setNumber: 1,
        wins: { alice: 2, bob: 0 },
        sets: { alice: 1, bob: 0 },
        setWinnerId: 'alice',
        nextStarterId: starter,
      });
      state = apply(game, state, next(starter));
      expect(game.getProgress(state, config)).toMatchObject({
        number: 1,
        setNumber: 2,
        wins: { alice: 0, bob: 0 },
        sets: { alice: 1, bob: 0 },
        setWinnerId: undefined,
      });
      for (const winner of ['bob', 'bob', 'alice', 'bob', 'alice']) {
        state = winLeg(game, state, winner);
        const progress = game.getProgress(state, config);
        if (progress.nextStarterId) state = apply(game, state, next(progress.nextStarterId));
      }
      expect(state).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
      expect(game.getProgress(state, config)).toMatchObject({
        number: 3,
        setNumber: 3,
        wins: { alice: 2, bob: 1 },
        sets: { alice: 2, bob: 1 },
        setWinnerId: 'alice',
        nextStarterId: undefined,
      });
      expect(() => apply(game, state, next('bob'))).toThrow('finished');
    },
  );
  it('allows a chosen first starter, maximum-length match and final lead changes', () => {
    const game = setup({ legsToWin: 2, firstStarterId: 'bob', startingRule: 'loser' });
    let state = game.initialState(config);
    expect(game.getLegConfig(state, config).ownerIds[0]).toBe('bob');
    state = winLeg(game, state, 'alice');
    state = apply(game, state, next('bob'));
    state = winLeg(game, state, 'bob');
    expect(state.status).toBe('in_progress');
    state = apply(game, state, next('alice'));
    state = winLeg(game, state, 'bob');
    expect(state).toMatchObject({ status: 'finished', winnerIds: ['bob'] });
    expect(game.getProgress(state, config)).toMatchObject({
      number: 3,
      wins: { alice: 1, bob: 2 },
    });
  });
  it('rejects missing or nonobject rules without bypassing trusted validation', () => {
    for (const value of [null, 42, [], { engine: 'unknown' }])
      expect(() => createDartsMatchGame(value, options)).toThrow('invalid_rules');
  });
  it('rejects a premature next leg, extra command fields, forged state and event deltas', () => {
    const game = setup();
    const state = game.initialState(config);
    expect(() => apply(game, state, next('alice'))).toThrow('invalid_command');
    expect(() => game.inspect({ ...state, legWinners: ['alice'] } as never, config)).toThrow(
      'invalid_state',
    );
    const event = game.decide(
      state,
      { type: 'record', ownerId: 'alice', values: { total: 180, checkout: 0 } },
      config,
    )[0]!;
    expect(() => game.evolve(state, { ...event, delta: 99 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(state).toEqual(game.initialState(config));
  });
  it.each([
    { legsToWin: 1 },
    { legsToWin: 2.5 },
    { legsToWin: 16 },
    { setsToWin: 1 },
    { setsToWin: 2.5 },
    { setsToWin: 6 },
    { setsToWin: 2, legsToWin: 8 },
    { startingRule: 'winner' },
    { firstStarterId: 'absent' },
    { extra: true },
  ])('rejects invalid pinned settings %j', (override) => {
    expect(() => {
      const game = setup(override as Partial<DartsMatchOptions>);
      game.initialState(config);
    }).toThrow();
  });
  it('rejects ambiguous multi-camp loser rules but preserves existing free-play single legs', () => {
    expect(() =>
      setup().initialState({ mode: 'individual', ownerIds: ['alice', 'bob', 'chris'] }),
    ).toThrow('invalid_config');
    expect(
      createGame(x01Version(301, true, '')).validateConfig({
        mode: 'individual',
        ownerIds: ['alice', 'bob', 'chris'],
      }).ownerIds,
    ).toHaveLength(3);
  });
  it('uses the same leg progression for teams and both Cricket variants', () => {
    for (const points of [true, false]) {
      const game = createDartsMatchGame(cricketVersion(points, '').definition, {
        ...options,
        legsToWin: 2,
      });
      const cfg = { ...config, mode: 'teams' as const };
      let state = game.initialState(cfg);
      for (let leg = 0; leg < 2; leg++) {
        let target = 0;
        const sectors = [20, 19, 18, 17, 16, 15, 25, 25];
        for (let i = 0; i < 30 && game.inspect(state, cfg).legState.status !== 'finished'; i++) {
          const position = game.inspect(state, cfg).legState as EngineState & { turn: number };
          const id = game.getLegConfig(state, cfg).ownerIds[position.turn]!;
          const sector = id === 'alice' ? sectors[target]! : 0;
          const multiplier = id === 'alice' ? (target === 6 ? 2 : target === 7 ? 1 : 3) : 1;
          if (id === 'alice') target++;
          state = apply(
            game,
            state,
            { type: 'record', ownerId: id, values: { sector, multiplier } },
            cfg,
          );
        }
        expect(game.getProgress(state, cfg).wins.alice).toBe(leg + 1);
        if (leg === 0) state = apply(game, state, next('bob'), cfg);
      }
      expect(state).toMatchObject({ status: 'finished', winnerIds: ['alice'] });
    }
  });
  it('pins settings, replays across leg boundaries, persists a final victory and reopens it on undo', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const pinned = { legsToWin: 2, startingRule: 'loser' as const, firstStarterId: 'lucas' };
      const match = await new DeclarativeRepository(db).create({
        id: 'darts-series',
        versionId: x01Version(301, false, '').id,
        mode: 'individual',
        playerIds: ['alice', 'lucas'],
        teams: [],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
        dartsMatch: pinned,
      });
      const game = createDartsMatchGame(match.rulesSnapshot.definition, pinned);
      const cfg = { mode: 'individual' as const, ownerIds: ['alice', 'lucas'] };
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
      let finalId = '';
      let firstLegWinnerId = '';
      for (let leg = 0; leg < 2; leg++) {
        for (let i = 0; i < 10; i++) {
          const view = await journal.read(match.id);
          const position = game.inspect(view.state, cfg).legState as EngineState & { turn: number };
          if (position.status === 'finished') break;
          const id = game.getLegConfig(view.state, cfg).ownerIds[position.turn]!;
          const result = await submit({
            type: 'record',
            ownerId: id,
            values: {
              total: id === 'alice' ? (position.totals[id] === 301 ? 180 : 121) : 0,
              checkout: 0,
            },
          });
          finalId = result.audit.at(-1)!.event.id;
        }
        if (leg === 0) {
          firstLegWinnerId = finalId;
          await submit(next('lucas'));
          db.close();
          await db.open();
        }
      }
      expect((await journal.read(match.id)).projection).toMatchObject({
        status: 'finished',
        winnerId: 'alice',
      });
      const before = await journal.read(match.id);
      await expect(
        submit({
          type: 'correct',
          targetEventId: firstLegWinnerId,
          replacement: { type: 'record', ownerId: 'alice', values: { total: 120, checkout: 0 } },
        }),
      ).rejects.toThrow();
      expect((await journal.read(match.id)).projection).toEqual(before.projection);
      await submit({ type: 'undo', targetEventId: finalId });
      db.close();
      await db.open();
      const reopened = await journal.read(match.id);
      expect(reopened.projection.status).toBe('in_progress');
      expect(game.getProgress(reopened.state, cfg).wins.alice).toBe(1);
      expect(match.settingsSnapshot.dartsMatch).toEqual(pinned);
    } finally {
      db.close();
      await db.delete();
    }
  });
});
