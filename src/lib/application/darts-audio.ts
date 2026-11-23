import type { BoardHit } from './granboard/protocol';
import { readPreference, writePreference } from './local-preferences';

export type DartsOutcome = 'hit' | 'bust' | 'legWin' | 'win';

const preferenceKey = 'scoretrackrr.darts-sound';
let soundEnabled = true;
let useStorage = true;
let audio: AudioContext | undefined;

export function dartsSoundEnabled() {
  return useStorage
    ? (readPreference(preferenceKey, (value): value is boolean => typeof value === 'boolean') ??
        soundEnabled)
    : soundEnabled;
}

export function setDartsSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  useStorage = writePreference(preferenceKey, enabled);
}

export function unlockDartsAudio() {
  if (!dartsSoundEnabled()) return;
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      // The browser can still play sound using its default audio session.
    }
  }
  try {
    audio ??= new AudioContext();
    if (audio.state !== 'running') void audio.resume().catch(() => {});
  } catch {
    // Scoring remains available on devices without audio.
  }
}

type Pulse = readonly [from: number, to: number, seconds: number];
type Cue = { wave: OscillatorType | 'brass'; volume: number; pulses: readonly Pulse[] };

const brassHarmonics = new Float32Array([0, 1, 0.87, 0.63, 0.39, 0.24, 0.13, 0.07]);
const brassPhase = new Float32Array(brassHarmonics.length);
let brassWave: PeriodicWave | undefined;

const strike: Pulse = [760, 185, 0.105];
const impact = (count: number): Cue => ({
  wave: 'sawtooth',
  volume: 0.16,
  pulses: Array<Pulse>(count).fill(strike),
});
const hits = [impact(1), impact(2), impact(3)];
const outerBull: Cue = { wave: 'triangle', volume: 0.24, pulses: [[245, 890, 0.22]] };
const innerBull: Cue = {
  wave: 'triangle',
  volume: 0.24,
  pulses: [
    [290, 1230, 0.12],
    [1230, 500, 0.19],
  ],
};
const miss: Cue = { wave: 'sine', volume: 0.24, pulses: [[350, 110, 0.09]] };
const bust: Cue = {
  wave: 'sawtooth',
  volume: 0.26,
  pulses: [
    [330, 262, 0.16],
    [262, 196, 0.19],
    [196, 98, 0.36],
  ],
};
const legWin: Cue = {
  wave: 'brass',
  volume: 0.25,
  pulses: [
    [523, 523, 0.11],
    [659, 659, 0.11],
    [784, 784, 0.22],
  ],
};
const matchWin: Cue = {
  wave: 'brass',
  volume: 0.27,
  pulses: [
    [392, 392, 0.1],
    [523, 523, 0.11],
    [659, 659, 0.11],
    [784, 784, 0.12],
    [1047, 1047, 0.28],
  ],
};

function cueFor(hit: BoardHit | undefined, outcome: DartsOutcome): Cue {
  if (outcome === 'win') return matchWin;
  if (outcome === 'legWin') return legWin;
  if (outcome === 'bust') return bust;
  if (!hit) return hits[0]!;
  if (hit.sector === 0) return miss;
  if (hit.sector === 25) return hit.multiplier === 2 ? innerBull : outerBull;
  return hits[hit.multiplier - 1] ?? hits[0]!;
}

export function playDartsSound(hit: BoardHit | undefined, outcome: DartsOutcome) {
  if (!dartsSoundEnabled() || audio?.state !== 'running') return;
  const { wave, volume, pulses } = cueFor(hit, outcome);
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  const start = audio.currentTime;
  let time = start;
  const brass = wave === 'brass';
  if (brass) {
    brassWave ??= audio.createPeriodicWave(brassPhase, brassHarmonics);
    oscillator.setPeriodicWave(brassWave);
  } else {
    oscillator.type = wave;
  }
  for (const [from, to, duration] of pulses) {
    const end = time + duration;
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, end);
    envelope.gain.setValueAtTime(0.001, time);
    envelope.gain.exponentialRampToValueAtTime(volume, time + (brass ? 0.026 : 0.015));
    if (brass) envelope.gain.exponentialRampToValueAtTime(volume * 0.8, time + duration * 0.68);
    envelope.gain.exponentialRampToValueAtTime(0.001, end);
    time = end + 0.018;
  }
  oscillator.connect(envelope).connect(audio.destination);
  oscillator.start(start);
  oscillator.stop(time);
}
