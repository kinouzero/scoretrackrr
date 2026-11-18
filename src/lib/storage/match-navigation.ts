import type { MatchRecord } from '#lib/domain/records';
import type { LocalDatabase } from './database';

// A session hint selects the foreground game; persisted status remains authoritative.
export async function findActiveMatch(
  database: LocalDatabase,
  selectedMatchId?: string | null,
  preferredMatchId?: string,
): Promise<MatchRecord | undefined> {
  if (selectedMatchId) {
    const selected = await database.matches.get(selectedMatchId);
    if (selected?.status === 'in_progress') return selected;
  }
  if (preferredMatchId) {
    const preferred = await database.matches.get(preferredMatchId);
    return preferred?.status === 'in_progress' ? preferred : undefined;
  }
  // Legacy data can contain several running games. Never scan or rewrite them.
  return database.matches.where('status').equals('in_progress').first();
}
