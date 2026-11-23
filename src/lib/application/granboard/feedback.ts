import type { DartsOutcome } from '../darts-audio';
import { cricketTargetStatus, cricketTargets, type CricketState } from '#lib/domain/games/cricket';
import type { BoardHit } from './protocol';

const off = 0;
const red = 1;
const yellow = 3;
const green = 4;
const violet = 6;
const colorWheel = [red, 2, yellow, green, 5, violet] as const;
// Wire slots are indexed by sector number. Physical neighbors follow the dartboard face.
const clockwise = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
export type LightPattern = Uint8Array<ArrayBuffer>;
export type LightOutcome = DartsOutcome | 'inactive';

function ring(color: number): LightPattern {
  return new Uint8Array(20).fill(color);
}

function spot(sector: number, color: number): LightPattern {
  const frame = ring(off);
  frame[sector - 1] = color;
  return frame;
}

function cluster(sector: number): LightPattern[] {
  const index = clockwise.indexOf(sector);
  const neighbors = [clockwise.at(index - 1)!, sector, clockwise[(index + 1) % 20]!];
  return [0, 1, 2].map((step) => {
    const frame = ring(off);
    const colors = [green, yellow, red];
    neighbors.forEach((number, i) => {
      frame[number - 1] = colors[(step + i) % colors.length]!;
    });
    return frame;
  });
}

function doubleBull(): LightPattern {
  // The native bull fade accepts RGB, including blue beyond the static palette.
  return Uint8Array.of(0x1f, 0, 220, 0, 0, 60, 255, 0, 220, 0, 2, 0, 20, 2, 0, 1);
}

export const readyLight = () => ring(green);
export const checkoutLight = (sector: number) =>
  sector === 25 ? ring(yellow) : spot(sector, yellow);

export function cricketLight(marks: CricketState['marks'], ownerId: string, points: boolean) {
  const frame = ring(off);
  let bull = off;
  cricketTargets.forEach((sector, index) => {
    const status = cricketTargetStatus(marks, ownerId, index, points);
    const color = status === 'close' ? green : status === 'score' ? yellow : off;
    if (sector === 25) bull = color;
    else frame[sector - 1] = color;
  });
  if (bull !== off && !frame.some(Boolean)) return ring(bull);
  return frame;
}

export function impactLights(hit: BoardHit, outcome: LightOutcome): LightPattern[] {
  if (outcome === 'win' || outcome === 'legWin') {
    return [
      ...colorWheel.map((_, step) => {
        const frame = ring(off);
        clockwise.forEach((number, index) => {
          frame[number - 1] = colorWheel[(index + step) % colorWheel.length]!;
        });
        return frame;
      }),
      ring(off),
    ];
  }
  if (outcome === 'bust') return [ring(violet)];
  if (hit.sector === 0) return [ring(red)];
  if (outcome === 'inactive') return [hit.sector === 25 ? ring(red) : spot(hit.sector, red)];
  if (hit.sector === 25) return [hit.multiplier === 2 ? doubleBull() : ring(green)];
  return hit.multiplier > 1 ? cluster(hit.sector) : [spot(hit.sector, green)];
}
