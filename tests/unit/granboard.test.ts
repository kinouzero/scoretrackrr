import { expect, test } from 'vitest';
import { decodeHit } from '#lib/application/granboard/protocol';

test.each([
  ['3.3@', 20, 1],
  ['3.5@', 20, 1],
  ['3.4@', 20, 3],
  ['3.6@', 20, 2],
  ['11.2@', 7, 3],
  ['8.0@', 25, 1],
  ['4.0@', 25, 2],
] as const)('maps notification %s to sector %i and multiplier %i', (frame, sector, multiplier) => {
  expect(decodeHit(frame)).toEqual({ sector, multiplier });
});

test.each(['BTN@', '3.4', '3.4@3.4@', 'UNKNOWN', ''])('ignores frame %s', (frame) => {
  expect(decodeHit(frame)).toBeUndefined();
});
