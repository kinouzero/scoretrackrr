import type { MatchRecord } from '#lib/domain/records';
import { petanqueSides, type EndCommand } from '#lib/domain/games/petanque';
import { messages } from '#lib/i18n/index';

export function petanqueEndLabel(match: MatchRecord, command: EndCommand): string {
  const name =
    petanqueSides(match).find((side) => side.id === command.ownerId)?.name ?? command.ownerId;
  const result =
    command.values.points === 0
      ? messages.petanque.voidLabel
      : messages.petanque.scoreLabel(name, command.values.points!);
  return command.values.kind === 2
    ? messages.petanque.deadLabel(
        result,
        command.values.remainingFirst!,
        command.values.remainingSecond!,
      )
    : result;
}
