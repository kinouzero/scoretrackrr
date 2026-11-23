import { expect, test, vi } from 'vitest';
import {
  playDartsSound,
  setDartsSoundEnabled,
  unlockDartsAudio,
  type DartsOutcome,
} from '#lib/application/darts-audio';
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
  const ends: number[] = [];
  let duration = 0;
  let usesBrass = false;
  const gain = {
    gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
    connect() {},
  };
  const audio = {
    state: 'running',
    currentTime: 0,
    createGain: () => gain,
    createPeriodicWave: () => ({}),
    createOscillator: () => ({
      frequency: {
        setValueAtTime: (value: number) => notes.push(value),
        exponentialRampToValueAtTime: (value: number) => ends.push(value),
      },
      connect: () => gain,
      setPeriodicWave() {
        usesBrass = true;
      },
      start() {},
      stop(time: number) {
        duration = time;
      },
    }),
  };
  const normal = [
    { sector: 20, multiplier: 1 },
    { sector: 20, multiplier: 2 },
    { sector: 20, multiplier: 3 },
    { sector: 25, multiplier: 1 },
    { sector: 25, multiplier: 2 },
    { sector: 0, multiplier: 1 },
  ];
  function cue(hit: BoardHit, outcome: DartsOutcome) {
    notes.length = 0;
    ends.length = 0;
    duration = 0;
    usesBrass = false;
    playDartsSound(hit, outcome);
    return { notes: [...notes], ends: [...ends], duration, usesBrass };
  }
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return audio;
    }),
  );
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
  });
  try {
    unlockDartsAudio();
    const impacts = normal.map((hit) => cue(hit, 'hit'));
    const [single, double, triple] = impacts;
    expect(double!.notes).toEqual([...single!.notes, ...single!.notes]);
    expect(triple!.notes).toEqual([...double!.notes, ...single!.notes]);
    expect(triple!.ends).toEqual([...double!.ends, ...single!.ends]);
    const outcomes = (['bust', 'legWin', 'win'] as const).map((outcome) => {
      const variants = normal.map((hit) => cue(hit, outcome));
      expect(
        variants.every((variant) => JSON.stringify(variant) === JSON.stringify(variants[0])),
      ).toBe(true);
      return variants[0]!;
    });
    expect(new Set([...impacts, ...outcomes].map(({ notes }) => notes.join(','))).size).toBe(9);
    expect(outcomes[0]!.duration).toBeGreaterThan(0.6);
    expect(impacts.every((sound) => !sound.usesBrass)).toBe(true);
    expect(outcomes.map((sound) => sound.usesBrass)).toEqual([false, true, true]);
    expect(outcomes[1]!.notes).toEqual(outcomes[1]!.ends);
    expect(outcomes[2]!.notes).toEqual(outcomes[2]!.ends);
    expect(outcomes[2]!.duration).toBeGreaterThan(outcomes[1]!.duration);
    setDartsSoundEnabled(false);
    expect(cue(normal[0]!, 'win').notes).toEqual([]);
  } finally {
    setDartsSoundEnabled(true);
    vi.unstubAllGlobals();
  }
});
