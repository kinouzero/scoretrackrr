import type { MatchRecord } from '#lib/domain/records';
import type { ScoreCommand } from '#lib/domain/engine/types';
import { messages } from '#lib/i18n/index';
export function yamsScoreLabel(
  match: MatchRecord,
  command: Extract<ScoreCommand, { type: 'record' }>,
) {
  const owner =
    match.teamsSnapshot.find((team) => team.id === command.ownerId)?.name ??
    match.playersSnapshot.find((player) => player.id === command.ownerId)?.displayName ??
    command.ownerId;
  return messages.yams.entry(
    owner,
    messages.yams.categories[command.values.category!]!,
    command.values.points!,
  );
}
