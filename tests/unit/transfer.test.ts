import 'fake-indexeddb/auto';
import type { JsonObject } from '../../src/lib/domain/records';
import { describe, expect, it } from 'vitest';
import { decodeGameTransfer, encodeGameTransfer } from '../../src/lib/domain/games/transfer';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { x01Version } from '../../src/lib/domain/games/darts';
import { counterDefinition } from '../../src/lib/domain/games/counter';
const timestamp = '2026-11-16T12:00:00.000Z';
const gameId = 'custom-12345678-1234-1234-1234-123456789abc';
const settings = {
  minimum: 0,
  maximum: 100,
  initialScore: 0,
  target: 10,
  direction: 'highest' as const,
};
const version = {
  id: 'version-a',
  gameId,
  rulesetVersion: 'one',
  schemaVersion: 1,
  definition: counterDefinition(gameId, 'one', settings) as unknown as JsonObject,
  publishedAt: timestamp,
  name: 'Counter',
};
describe('portable immutable game definitions', () => {
  it('round-trips custom and built-in rules without profiles, matches or device data', () => {
    for (const value of [version, x01Version(301, true, timestamp)]) {
      const encoded = encodeGameTransfer(value, value.name!);
      expect(decodeGameTransfer(encoded).definition).toEqual(value.definition);
      expect(encoded).not.toContain('playersSnapshot');
      expect(encoded).not.toContain('deviceId');
    }
  });
  it('rejects syntax, incompatible envelopes, unknown engines, scripts, identity changes and oversized input', () => {
    const data = JSON.parse(encodeGameTransfer(version, 'Counter'));
    for (const value of [
      { ...data, formatVersion: 2 },
      { ...data, extra: true },
      { ...data, gameId: 'yams' },
      { ...data, definition: { ...data.definition, script: 'alert(1)' } },
      { ...data, definition: { ...data.definition, score: { op: 'eval', code: 'x' } } },
    ])
      expect(() => decodeGameTransfer(JSON.stringify(value))).toThrow();
    expect(() => decodeGameTransfer('{')).toThrow();
    expect(() => decodeGameTransfer('x'.repeat(65537))).toThrow('input_limit');
  });
  it('imports a fresh custom copy on another database and preserves existing versions and favorites', async () => {
    const a = new LocalDatabase(crypto.randomUUID()),
      b = new LocalDatabase(crypto.randomUUID());
    try {
      const source = new CatalogRepository(a),
        destination = new CatalogRepository(b);
      await source.initialize(timestamp);
      await destination.initialize(timestamp);
      await source.publishCounter({
        ...settings,
        gameId,
        versionId: version.id,
        rulesetVersion: 'one',
        name: 'Portable counter',
        publishedAt: timestamp,
      });
      await source.setFavorite(gameId, true);
      const text = await source.exportVersion(version.id);
      const fresh = 'custom-87654321-4321-4321-4321-cba987654321';
      const imported = await destination.importGame(text, {
        gameId: fresh,
        versionId: 'imported',
        rulesetVersion: 'copy',
        publishedAt: timestamp,
      });
      expect(imported.definition).toEqual({
        ...version.definition,
        id: fresh,
        rulesetVersion: 'copy',
      });
      expect(await b.matches.count()).toBe(0);
      expect(await b.players.count()).toBe(0);
      expect((await a.games.get(gameId))?.favorite).toBe(true);
      const count = await b.gameVersions.count();
      await expect(
        destination.importGame(text, {
          gameId: fresh,
          versionId: 'collision',
          rulesetVersion: 'copy2',
          publishedAt: timestamp,
        }),
      ).rejects.toThrow('conflict');
      expect(await b.gameVersions.count()).toBe(count);
      const builtin = await destination.importGame(
        await source.exportVersion(x01Version(301, true, '').id),
        { gameId: fresh, versionId: 'ignored', rulesetVersion: 'ignored', publishedAt: timestamp },
      );
      expect(builtin.id).toBe(x01Version(301, true, '').id);
      expect(await b.gameVersions.count()).toBe(count);
    } finally {
      a.close();
      b.close();
      await a.delete();
      await b.delete();
    }
  });
});
