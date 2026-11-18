import { EngineError } from '../engine/types';
export function dartScore(sector: number, multiplier: number) {
  if (
    !Number.isInteger(sector) ||
    !(sector === 0 || (sector >= 1 && sector <= 20) || sector === 25) ||
    !Number.isInteger(multiplier) ||
    multiplier < 1 ||
    multiplier > 3 ||
    (sector === 0 && multiplier !== 1) ||
    (sector === 25 && multiplier === 3)
  )
    throw new EngineError('invalid_command');
  return sector * multiplier;
}

export const scoringDarts = Object.freeze(
  Array.from({ length: 20 }, (_, i) => i + 1)
    .flatMap((sector) => [1, 2, 3].map((multiplier) => Object.freeze({ sector, multiplier })))
    .concat([
      Object.freeze({ sector: 25, multiplier: 1 }),
      Object.freeze({ sector: 25, multiplier: 2 }),
    ])
    .sort((a, b) => dartScore(b.sector, b.multiplier) - dartScore(a.sector, a.multiplier)),
);
