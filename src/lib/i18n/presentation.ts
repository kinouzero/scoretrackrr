import type { GameVersionRecord, MatchRecord } from '#lib/domain/records';
import { gameCatalog } from '#lib/domain/games/catalog';
import { historyGameName as storedGameName } from '#lib/domain/history';
import { messages, getLocale } from './index';
import { translate } from './catalog';

/** Localize built-in captions without rewriting immutable rules or user-provided names. */
export function gameName(id: string, fallback: string): string {
  return id === '6-qui-prend' ? translate(getLocale(), 'gameNames.6-qui-prend') : fallback;
}
export function historyGameName(match: MatchRecord): string {
  if (match.rulesSnapshot.gameId === '5000-10000') {
    const target = match.rulesSnapshot.definition.target;
    if (target === 5000 || target === 10000) return String(target);
  }
  return gameName(match.rulesSnapshot.gameId, storedGameName(match));
}
export function versionName(version: GameVersionRecord): string {
  const t = (key: string, values = {}) => translate(getLocale(), `versions.${key}`, values);
  const rules = version.definition;
  switch (version.gameId) {
    case '421':
      return t('four21');
    case 'skull-king':
      return t('skull', {
        scoring: rules.scoring === 'rascal' ? 'rascal' : 'classic',
        expansion: rules.expansion ? 'yes' : 'no',
      });
    case 'flip-7':
      return t('flip');
    case '6-qui-prend':
      return t('sixNimmt', { expansion: String(rules.expansion) });
    case 'times-up':
      return t('timesUp', {
        seconds: rules.durationSeconds as number,
      });
    case 'molkky':
      return t('molkky', {
        teams:
          Array.isArray(rules.supportedModes) && rules.supportedModes.includes('teams')
            ? 'yes'
            : 'no',
      });
    case '5000-10000':
      return t('farkle', { target: rules.target, entry: rules.entry });
    case 'darts':
      return rules.engine === 'cricket'
        ? t('cricket', { points: rules.points ? 'yes' : 'no' })
        : t('darts', { start: rules.start, doubleOut: rules.doubleOut ? 'yes' : 'no' });
    case 'yams':
      return rules.upperBonus ? messages.yams.withBonus : messages.yams.withoutBonus;
    default:
      return version.name ?? '';
  }
}
/** Translate the finite built-in search aliases back to their indexed canonical names. */
export function catalogSearch(input: string): string {
  const query = input.trim().toLocaleLowerCase(getLocale());
  const matches = gameCatalog.filter(
    (game) =>
      gameName(game.id, game.name) !== game.name &&
      gameName(game.id, game.name).toLocaleLowerCase(getLocale()).startsWith(query),
  );
  return query && matches.length === 1 ? matches[0]!.name : input;
}
