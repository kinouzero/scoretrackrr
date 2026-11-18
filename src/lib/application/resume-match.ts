import type { MatchRecord } from '#lib/domain/records';
import type { MatchJournal } from '#lib/storage/journal';

export async function resumePausedMatch(
  journal: MatchJournal,
  match: MatchRecord,
  deviceId: string,
) {
  const view = await journal.read(match.id);
  return journal.submit({
    matchId: match.id,
    expectedVersion: match.version,
    actorPlayerId: view.authority.playerId,
    deviceId,
    eventId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action: { type: 'resume' },
  });
}
