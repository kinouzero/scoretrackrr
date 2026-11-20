import type { BoardHit } from './protocol';

type Color = readonly [red: number, green: number, blue: number];

function ledFrame(animation: number, color: Color, speed: number) {
  // GranBoard ring commands use a 16-byte frame. See the linked protocol reference in Darts.md.
  const frame = new Uint8Array(16);
  frame[0] = animation;
  frame.set(color, 1);
  frame[12] = speed;
  frame[15] = 1;
  return frame;
}

export const readyLight = () => ledFrame(0x15, [0, 200, 95], 10);

export function impactLight(hit: BoardHit, outcome: ImpactOutcome) {
  const color: Color =
    outcome === 'win'
      ? [255, 220, 95]
      : outcome === 'bust'
        ? [240, 35, 35]
        : hit.sector === 0
          ? [190, 85, 50]
          : hit.sector === 25
            ? hit.multiplier === 2
              ? [250, 40, 110]
              : [225, 110, 10]
            : hit.multiplier === 3
              ? [185, 55, 240]
              : hit.multiplier === 2
                ? [25, 110, 250]
                : [10, 200, 135];
  const frame = ledFrame(0x14, color, 20);
  frame[4] = 125;
  return frame;
}

export type ImpactOutcome = 'hit' | 'bust' | 'win';

type Cue = readonly [wave: OscillatorType, notes: readonly number[], step: number];
const singles: Cue = ['triangle', [440], 0.12];
const doubles: Cue = ['triangle', [523, 659], 0.09];
const triples: Cue = ['triangle', [587, 740, 880], 0.075];
const outerBull: Cue = ['sine', [932, 698], 0.14];
const innerBull: Cue = ['triangle', [784, 1175], 0.17];
const miss: Cue = ['sine', [300, 246], 0.055];
const bust: Cue = ['triangle', [392, 294, 196], 0.14];
const win: Cue = ['triangle', [523, 659, 784, 1047], 0.16];

function cueFor(hit: BoardHit, outcome: ImpactOutcome): Cue {
  if (outcome === 'win') return win;
  if (outcome === 'bust') return bust;
  if (hit.sector === 0) return miss;
  if (hit.sector === 25) return hit.multiplier === 2 ? innerBull : outerBull;
  return hit.multiplier === 3 ? triples : hit.multiplier === 2 ? doubles : singles;
}

export function playImpact(audio: AudioContext, hit: BoardHit, outcome: ImpactOutcome) {
  if (audio.state !== 'running') return;
  const [wave, notes, step] = cueFor(hit, outcome);
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const now = audio.currentTime;
  oscillator.type = wave;
  notes.forEach((frequency, index) => {
    const time = now + index * step;
    oscillator.frequency.setValueAtTime(frequency, time);
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.exponentialRampToValueAtTime(0.23, time + 0.009);
    gain.gain.exponentialRampToValueAtTime(0.001, time + step * 0.9);
  });
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now);
  oscillator.stop(now + step * notes.length);
}
