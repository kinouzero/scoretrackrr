import { expect, it } from 'vitest';
import {
  createScoreSheetGame,
  scoreSheetVersion,
  skyjoPoints,
  tarotPoints,
  qwixxPoints,
  cleverPoints,
  wondersScience,
} from '#lib/domain/games/score-sheets';

it('calculates the closing penalty only on positive scores without a strict lead', () => {
  expect(skyjoPoints(12, 12, true)).toBe(24);
  expect(skyjoPoints(12, 13, true)).toBe(12);
  expect(skyjoPoints(-2, -4, true)).toBe(-2);
});

it('distributes signed Tarot contracts across the taker, partner and defenders', () => {
  expect(tarotPoints(5, 0, 3, 43, 2, 2, 10)).toEqual([128, -64, -64, 64, -64]);
  expect(tarotPoints(3, 1, -1, 50, 1, 4, 0)).toEqual([104, -208, 104]);
});

it('scores endgame categories, matching science sets and foxes', () => {
  expect(wondersScience([3, 2, 1])).toBe(21);
  expect(qwixxPoints([3, 4, 2, 1], 2)).toBe(10);
  expect(cleverPoints([10, 2, 3, 4, 6], 3)).toBe(31);
});

it('replays a complete threshold round before declaring the lowest total winner', () => {
  const game = createScoreSheetGame('skyjo', scoreSheetVersion('skyjo', '').definition);
  const config = { mode: 'individual' as const, ownerIds: ['alice', 'bob'] };
  const initial = game.initialState(config);
  const action = {
    type: 'record' as const,
    ownerId: 'alice',
    values: { round: 1, end: 0, p0: 101, p1: 8 },
  };
  expect(() =>
    game.decide(initial, { ...action, values: { round: 1, end: 0, p0: 101 } }, config),
  ).toThrow('invalid_command');
  const [event] = game.decide(initial, action, config);
  expect(game.evolve(initial, event!, config)).toMatchObject({
    status: 'finished',
    totals: { alice: 101, bob: 8 },
    winnerIds: ['bob'],
  });
});
