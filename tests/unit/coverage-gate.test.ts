import { expect, it } from 'vitest';
import { coverageFailures } from '../../scripts/coverage-checks.mjs';

it('accepts the exact minimum and higher measured coverage', () => {
  expect(
    coverageFailures({ lines: { pct: 93 }, branches: { pct: 91.5 } }, { lines: 93, branches: 83 }),
  ).toEqual([]);
});
it('fails closed for missing, invalid or insufficient metrics', () => {
  expect(
    coverageFailures(
      { lines: { pct: 92.99 }, functions: { pct: Number.NaN }, statements: { pct: '100' } },
      { lines: 93, branches: 83, functions: 92, statements: 91 },
    ),
  ).toEqual([
    'lines: 92.99% (minimum 93%)',
    'branches: missing% (minimum 83%)',
    'functions: NaN% (minimum 92%)',
    'statements: 100% (minimum 91%)',
  ]);
});
