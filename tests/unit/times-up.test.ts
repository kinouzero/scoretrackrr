import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createTimesUpGame,
  timesUpVersion,
  timerClock,
  timerRemaining,
} from '../../src/lib/domain/games/times-up';
import type { EngineState, ScoreCommand } from '../../src/lib/domain/engine/types';
import { createGame } from '../../src/lib/domain/games/engine';
import { decodeGameTransfer, encodeGameTransfer } from '../../src/lib/domain/games/transfer';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { TeamRepository } from '../../src/lib/storage/teams';
import { BackupRepository } from '../../src/lib/storage/backup';
import { seedJournal, timestamp } from '../fixtures/journal';
const config = { mode: 'teams' as const, ownerIds: ['blue', 'red'] };
const game = createTimesUpGame(timesUpVersion('').definition);
const base = Date.parse(timestamp);
function action(
  kind: number,
  turn = 0,
  at = base,
  points?: number,
): Extract<ScoreCommand, { type: 'record' }> {
  return {
    type: 'record',
    ownerId: config.ownerIds[turn % 2]!,
    values: { kind, turn, ...timerClock(at), ...(points === undefined ? {} : { points }) },
  };
}
function apply(state: EngineState, cmd: ScoreCommand) {
  return game.decide(state, cmd, config).reduce((s, e) => game.evolve(s, e, config), state);
}
describe('Times Up Party', () => {
  it('persists wall-clock deadlines, pauses and resumes only the remaining duration', () => {
    const initial = game.initialState(config);
    let state = apply(initial, action(0));
    expect(timerRemaining(game.inspect(state, config), base + 12_000)).toBe(18_000);
    expect(
      timerRemaining(game.inspect(JSON.parse(JSON.stringify(state)), config), base + 31_000),
    ).toBe(0);
    expect(timerRemaining(game.inspect(state, config), base - 1000)).toBe(30_000);
    state = apply(state, action(1, 0, base + 12_000));
    expect(timerRemaining(game.inspect(state, config), base + 120_000)).toBe(18_000);
    state = apply(state, action(0, 0, base + 120_000));
    expect(timerRemaining(game.inspect(state, config), base + 130_000)).toBe(8000);
    expect(initial).toEqual(game.initialState(config));
  });
  it('alternates teams across all three40-card rounds and awards the greatest total', () => {
    let state = game.initialState(config);
    for (let turn = 0; turn < 3; turn++) {
      state = apply(state, action(0, turn));
      state = apply(state, action(2, turn, base, 40));
      expect(game.inspect(state, config)).toMatchObject({
        round: Math.min(turn + 2, 3),
        cards: turn === 2 ? 0 : 40,
        turn: turn + 1,
        started: false,
      });
    }
    expect(state).toMatchObject({
      status: 'finished',
      totals: { blue: 80, red: 40 },
      winnerIds: ['blue'],
    });
    expect(() => apply(state, action(0, 3))).toThrow('finished');
  });
  it('accepts a zero-card expired turn and shares tied victories', () => {
    let state = apply(game.initialState(config), action(0));
    state = apply(state, action(2, 0, base + 30_000, 0));
    for (let turn = 1; turn <= 6; turn++) {
      state = apply(state, action(0, turn, base + 30_000));
      state = apply(state, action(2, turn, base + 30_000, 20));
    }
    expect(state.winnerIds).toEqual(['blue', 'red']);
    expect(state.totals).toEqual({ blue: 60, red: 60 });
  });
  it('validates clock boundaries across midnight and rejects stale/wrong-team or malformed actions', () => {
    let state = game.initialState(config);
    expect(() => apply(state, action(2, 0, base, 1))).toThrow('invalid_command');
    state = apply(state, action(0));
    for (const cmd of [
      action(0),
      action(1, 1),
      action(2, 0, base, 41),
      action(2, 0, base, -1),
      action(2, 0, base, 0.5),
      action(1, 0, base - 1),
      { ...action(1), ownerId: 'red' },
      { ...action(1), values: { ...action(1).values, ms: 86_400_000 } },
      { ...action(1), values: { ...action(1).values, extra: 1 } },
    ] as ScoreCommand[])
      expect(() => apply(state, cmd)).toThrow('invalid_command');
    const midnight = 86_400_000 * 20_000 - 1000;
    const crossing = apply(game.initialState(config), action(0, 0, midnight));
    expect(timerRemaining(game.inspect(crossing, config), midnight + 2000)).toBe(28_000);
    expect(apply(state, action(3))).toMatchObject({
      started: false,
      deadline: null,
      remainingMs: 30_000,
    });
  });
  it('validates immutable rules, team bounds, states and replayed deltas', () => {
    expect(() => createTimesUpGame({ ...timesUpVersion('').definition, duration: 60 })).toThrow();
    for (const cfg of [
      { ...config, mode: 'individual' },
      { ...config, ownerIds: ['one'] },
      { ...config, ownerIds: Array.from({ length: 7 }, (_, i) => `t${i}`) },
    ])
      expect(() => game.initialState(cfg as never)).toThrow('invalid_config');
    const initial = game.initialState(config);
    for (const change of [
      { cards: 0 },
      { round: 4 },
      { remainingMs: 30_001 },
      { deadline: base },
      { totals: { blue: 1, red: 0 } },
      { started: 1 },
      { turn: -1 },
    ])
      expect(() => game.inspect({ ...initial, ...change } as never, config)).toThrow(
        'invalid_state',
      );
    const event = game.decide(initial, action(0), config)[0]!;
    expect(() => game.evolve(initial, { ...event, delta: 1 } as never, config)).toThrow(
      'invalid_event',
    );
    expect(createGame(timesUpVersion('')).id).toBe('times-up');
    expect(decodeGameTransfer(encodeGameTransfer(timesUpVersion(''), 'Time’s Up!')).gameId).toBe(
      'times-up',
    );
  });
  it('rejects a one-person team before creating any match records', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const blue = (await db.teams.get('blue'))!;
      await new TeamRepository(db).saveTeam({ ...blue, format: 'free' }, ['alice']);
      const before = await db.matches.count();
      await expect(
        new DeclarativeRepository(db).create({
          id: 'invalid-times-match',
          versionId: timesUpVersion('').id,
          mode: 'teams',
          playerIds: [],
          teams: [
            { id: 'blue', revision: (await db.teams.get('blue'))!.revision ?? 0 },
            { id: 'red', revision: (await db.teams.get('red'))!.revision ?? 0 },
          ],
          organizerPlayerId: 'alice',
          cooperativeName: '',
          createdAt: timestamp,
        }),
      ).rejects.toThrow('invalid_record');
      expect(await db.matches.count()).toBe(before);
    } finally {
      db.close();
      await db.delete();
    }
  });
  it('replays timers, corrects/undoes scoring and restores a full backup without a schema change', async () => {
    const db = new LocalDatabase(crypto.randomUUID()),
      copy = new LocalDatabase(crypto.randomUUID());
    try {
      await seedJournal(db);
      await new CatalogRepository(db).initialize(timestamp);
      const match = await new DeclarativeRepository(db).create({
        id: 'times-match',
        versionId: timesUpVersion('').id,
        mode: 'teams',
        playerIds: [],
        teams: [
          { id: 'blue', revision: (await db.teams.get('blue'))!.revision ?? 0 },
          { id: 'red', revision: (await db.teams.get('red'))!.revision ?? 0 },
        ],
        organizerPlayerId: 'alice',
        cooperativeName: '',
        createdAt: timestamp,
      });
      const journal = new MatchJournal(db);
      async function submit(cmd: Record<string, unknown>) {
        const view = await journal.read(match.id);
        return journal.submit({
          matchId: match.id,
          eventId: crypto.randomUUID(),
          commandId: crypto.randomUUID(),
          expectedVersion: view.projection.lastEventSequence,
          actorPlayerId: 'alice',
          deviceId: 'test-device',
          timestamp,
          action: cmd as never,
        });
      }
      await submit({ type: 'start' });
      await submit(action(0));
      db.close();
      await db.open();
      expect(
        timerRemaining(game.inspect((await journal.read(match.id)).state, config), base + 15_000),
      ).toBe(15_000);
      const scored = await submit(action(2, 0, base + 30_000, 40));
      const corrected = await submit({
        type: 'correct',
        targetEventId: scored.audit.at(-1)!.event.id,
        replacement: action(2, 0, base + 30_000, 10),
      });
      expect(game.inspect(corrected.state, config)).toMatchObject({
        round: 1,
        cards: 30,
        totals: { blue: 10, red: 0 },
      });
      const undone = await submit({
        type: 'undo',
        targetEventId: corrected.audit.at(-1)!.event.id,
      });
      expect(game.inspect(undone.state, config)).toMatchObject({
        turn: 0,
        cards: 40,
        deadline: base + 30_000,
      });
      await new BackupRepository(copy).restore(await new BackupRepository(db).export(timestamp));
      expect((await new MatchJournal(copy).read(match.id)).state).toEqual(undone.state);
    } finally {
      for (const database of [db, copy]) {
        database.close();
        await database.delete();
      }
    }
  });
});
