import { expect, test } from 'vitest';
import { playImpact, type ImpactOutcome } from '#lib/application/granboard/feedback';
import { decodeHit, type BoardHit } from '#lib/application/granboard/protocol';

test.each([
  ['3.3@', 20, 1],
  ['3.5@', 20, 1],
  ['3.4@', 20, 3],
  ['3.6@', 20, 2],
  ['11.2@', 7, 3],
  ['OUT@', 0, 1],
  ['8.0@', 25, 1],
  ['4.0@', 25, 2],
] as const)('maps notification %s to sector %i and multiplier %i', (frame, sector, multiplier) => {
  expect(decodeHit(frame)).toEqual({ sector, multiplier });
});

test.each(['BTN@', '3.4', '3.4@3.4@', 'UNKNOWN', ''])('ignores frame %s', (frame) => {
  expect(decodeHit(frame)).toBeUndefined();
});

test('plays distinct patterns for every kind of impact, with bust and victory taking priority', () => {
  const notes: number[] = [];
  const gain = {
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {},
  };
  const audio = {
    state: 'running',
    currentTime: 0,
    createGain: () => gain,
    createOscillator: () => ({
      frequency: { setValueAtTime: (value: number) => notes.push(value) },
      connect: () => gain,
      start() {},
      stop() {},
    }),
  } as unknown as AudioContext;
  const normal = [
    { sector: 20, multiplier: 1 },
    { sector: 20, multiplier: 2 },
    { sector: 20, multiplier: 3 },
    { sector: 25, multiplier: 1 },
    { sector: 25, multiplier: 2 },
    { sector: 0, multiplier: 1 },
  ];
  function cue(hit: BoardHit, outcome: ImpactOutcome) {
    notes.length = 0;
    playImpact(audio, hit, outcome);
    return notes.join(',');
  }
  const busts = normal.map((hit) => cue(hit, 'bust'));
  const victories = normal.map((hit) => cue(hit, 'win'));
  expect(new Set(busts).size).toBe(1);
  expect(new Set(victories).size).toBe(1);
  expect(new Set([...normal.map((hit) => cue(hit, 'hit')), ...busts, ...victories]).size).toBe(8);
});
