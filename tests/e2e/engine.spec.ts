import { waitForOfflineReady } from '../fixtures/offline';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from '../fixtures/browser';
import { build } from 'vite';

test('runs the pure engine offline without runtime code generation or networking', async ({
  page,
  context,
}) => {
  // Build only the domain entry in memory; no production route or test data is shipped.
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: true,
      lib: { entry: resolve('src/lib/domain/engine/declarative.ts'), formats: ['es'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const entry = outputs
    .flatMap((output) => ('output' in output ? output.output : []))
    .find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
  if (!entry || entry.type !== 'chunk') throw new Error('Missing engine test bundle');
  await test.info().attach('engine-bundle-size', {
    body: `Minified: ${Buffer.byteLength(entry.code)} bytes; gzip: ${gzipSync(entry.code).length} bytes`,
    contentType: 'text/plain',
  });
  await page.goto('/');
  await waitForOfflineReady(page);
  await context.setOffline(true);
  const outcome = await page.evaluate(async (code) => {
    const forbidden = () => {
      throw new Error('Unexpected runtime code generation or network request');
    };
    Object.defineProperty(window, 'Function', { value: forbidden });
    Object.defineProperty(window, 'eval', { value: forbidden });
    Object.defineProperty(window, 'fetch', { value: forbidden });
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      const { createDeclarativeGame, replayEvents } = await import(url);
      const game = createDeclarativeGame({
        schemaVersion: 1,
        id: 'engine-fixture',
        rulesetVersion: '1',
        supportedModes: ['teams'],
        fields: [{ id: 'points', minimum: 0, maximum: 6, integer: true }],
        score: { op: 'input', field: 'points' },
        initialScore: 0,
        objective: { direction: 'highest', target: 13 },
        ties: 'shared',
      });
      const config = game.validateConfig({ mode: 'teams', ownerIds: ['blue', 'red'] });
      let state = game.initialState(config);
      const journal = [];
      for (const [ownerId, points] of [
        ['blue', 4],
        ['red', 2],
        ['blue', 5],
        ['blue', 4],
      ]) {
        const events = game.decide(state, { type: 'record', ownerId, values: { points } }, config);
        for (const event of events) {
          state = game.evolve(state, event, config);
          journal.push(event);
        }
      }
      const restored = replayEvents(game, config, JSON.parse(JSON.stringify(journal)));
      return {
        totals: state.totals,
        winnerIds: state.winnerIds,
        status: state.status,
        restored: JSON.stringify(restored) === JSON.stringify(state),
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, entry.code);
  expect(outcome).toEqual({
    totals: { blue: 13, red: 2 },
    winnerIds: ['blue'],
    status: 'finished',
    restored: true,
  });
});
