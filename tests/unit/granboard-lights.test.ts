import { expect, test } from 'vitest';
import { checkoutLight, cricketLight, impactLights } from '#lib/application/granboard/feedback';

test('Cricket distinguishes targets to close, score on, and ignore across opponents', () => {
  const marks = {
    a: [3, 3, 3, 3, 1, 0, 2],
    b: [0, 3, 3, 3, 3, 3, 3],
    c: [3, 3, 2, 3, 3, 3, 3],
  };
  expect([...cricketLight(marks, 'a', true).slice(14)]).toEqual([4, 4, 0, 3, 0, 3]);
  expect([...cricketLight(marks, 'a', false).slice(14)]).toEqual([4, 4, 0, 0, 0, 0]);
});

test('Cricket uses the whole ring when bull is the only useful target', () => {
  const closedNumbers = Array(6).fill(3);
  const a = [...closedNumbers, 2];
  const b = [...closedNumbers, 1];
  expect([...cricketLight({ a, b }, 'a', true)]).toEqual(Array(20).fill(4));
  a[6] = 3;
  expect([...cricketLight({ a, b }, 'a', true)]).toEqual(Array(20).fill(3));
  expect([...cricketLight({ a, b }, 'a', false)]).toEqual(Array(20).fill(0));
});

test('lights only the suggested sector or the whole ring for either bull', () => {
  const sector12 = Array(20).fill(0);
  sector12[11] = 3;
  expect([...checkoutLight(12)]).toEqual(sector12);
  expect([...checkoutLight(25)]).toEqual(Array(20).fill(3));
});

test.each([2, 3])(
  'rotates green, yellow and red through the physical neighbors of a x%s',
  (multiplier) => {
    const frames = impactLights({ sector: 20, multiplier }, 'hit');
    expect(frames.map((frame) => [frame[4], frame[19], frame[0]])).toEqual([
      [4, 3, 1],
      [3, 1, 4],
      [1, 4, 3],
    ]);
    for (const frame of frames) {
      expect(frame.filter(Boolean)).toHaveLength(3);
    }
  },
);

test('uses distinct full-ring colors for bulls, a missed dart and a bust', () => {
  expect([...impactLights({ sector: 25, multiplier: 1 }, 'hit')[0]!]).toEqual(Array(20).fill(4));
  expect([...impactLights({ sector: 25, multiplier: 2 }, 'hit')[0]!]).toEqual([
    31, 0, 220, 0, 0, 60, 255, 0, 220, 0, 2, 0, 20, 2, 0, 1,
  ]);
  expect([...impactLights({ sector: 0, multiplier: 1 }, 'hit')[0]!]).toEqual(Array(20).fill(1));
  expect([...impactLights({ sector: 25, multiplier: 2 }, 'bust')[0]!]).toEqual(Array(20).fill(6));
});

test.each(['legWin', 'win'] as const)('rotates colors around the ring on %s', (outcome) => {
  const frames = impactLights({ sector: 25, multiplier: 2 }, outcome);
  expect(new Set(frames.map((frame) => frame.join(','))).size).toBe(7);
  for (const frame of frames.slice(0, -1)) {
    expect(frame.filter(Boolean)).toHaveLength(20);
    expect(new Set(frame).size).toBe(6);
  }
  expect([...frames.at(-1)!]).toEqual(Array(20).fill(0));
});
