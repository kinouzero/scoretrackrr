import 'fake-indexeddb/auto';
import { afterAll, test } from 'vitest';
import type { ScoreCommand } from '../../src/lib/domain/engine/types';
import { previewScore, createScorePreview } from '../../src/lib/application/score-preview';
import { createGame } from '../../src/lib/domain/games/engine';
import { x01Version } from '../../src/lib/domain/games/darts';
import { molkkyVersion } from '../../src/lib/domain/games/molkky';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { LocalDatabase, seedJournal, timestamp } from '../fixtures/journal';
const db = new LocalDatabase(crypto.randomUUID());
await seedJournal(db);
await new CatalogRepository(db).initialize(timestamp);
afterAll(async () => {
  db.close();
  await db.delete();
});
for (const version of [x01Version(301, true, ''), molkkyVersion('')]) {
  const match = await new DeclarativeRepository(db).create({
    id: version.id,
    versionId: version.id,
    mode: 'individual',
    playerIds: ['alice', 'lucas'],
    teams: [],
    organizerPlayerId: 'alice',
    cooperativeName: '',
    createdAt: timestamp,
  });
  const game = createGame(match.rulesSnapshot),
    config = game.validateConfig(match.settingsSnapshot.engineConfig),
    state = game.initialState(config);
  const command: ScoreCommand = {
    type: 'record' as const,
    ownerId: 'alice',
    values: version.gameId === 'darts' ? { sector: 20, multiplier: 3 } : { points: 12, turn: 0 },
  };
  const evaluate = createScorePreview(match);
  test(`${version.gameId} live preview`, async ({ bench }) => {
    await bench.compare(
      bench('one-shot context', () => {
        previewScore(match, state, command);
      }),
      bench('reused context', () => {
        evaluate(state, command);
      }),
      { time: 300, warmupTime: 100, iterations: 20, warmupIterations: 10 },
    );
  });
}
