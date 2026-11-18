import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { decodePeerView, encodePeerView, validatePeerUpdate } from '../../src/lib/domain/peer-view';
import { LocalDatabase } from '../../src/lib/storage/database';
import { seedJournal } from '../fixtures/journal';
import { replayJournal } from '../../src/lib/domain/journal';
describe('historical peer view compatibility boundaries', () => {
  it('transfers only bounded names, totals and compatible rules; no profile emails or cached avatars', async () => {
    const db = new LocalDatabase(crypto.randomUUID());
    try {
      const match = await seedJournal(db);
      const projection = replayJournal(match, []).projection;
      const text = encodePeerView(match, projection);
      const decoded = decodePeerView(text);
      expect(decoded.owners.map((owner) => owner.id)).toEqual(['blue', 'red']);
      expect(text).not.toContain('email');
      expect(text).not.toContain('avatar');
      expect(() =>
        decodePeerView(
          JSON.stringify({ ...decoded, owners: [{ id: 'blue', name: 'bad', total: 1e20 }] }),
        ),
      ).toThrow();
      expect(() => decodePeerView(JSON.stringify({ ...decoded, protocol: 2 }))).toThrow();
      for (const rules of [
        { ...decoded.rules, schemaVersion: 2 },
        { ...decoded.rules, name: 'bad\nname' },
        { ...decoded.rules, publishedAt: 'not a date' },
        { ...decoded.rules, email: 'must-not-travel@example.test' },
        { ...decoded.rules, definition: { ...decoded.rules.definition, script: 'run' } },
      ])
        expect(() => decodePeerView(JSON.stringify({ ...decoded, rules }))).toThrow();
      expect(validatePeerUpdate(undefined, decoded)).toEqual(decoded);
      expect(validatePeerUpdate(decoded, decoded)).toEqual(decoded);
      const next = {
        ...decoded,
        version: decoded.version + 1,
        owners: decoded.owners.map((owner) => ({ ...owner, total: 1 })),
      };
      expect(validatePeerUpdate(decoded, next)).toEqual(next);
      for (const changed of [
        { ...next, matchId: 'another-match' },
        { ...next, rules: { ...next.rules, rulesetVersion: '2' } },
        { ...next, options: { altered: true } },
        { ...next, mode: 'individual' as const },
        { ...next, owners: next.owners.slice().reverse() },
        { ...next, owners: next.owners.map((owner) => ({ ...owner, name: 'different name' })) },
        { ...next, version: decoded.version },
        { ...decoded, version: -1 },
      ])
        expect(() => validatePeerUpdate(decoded, changed)).toThrow('INVALID_VERSION');
    } finally {
      db.close();
      await db.delete();
    }
  });
});
