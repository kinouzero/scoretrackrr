import type { JsonObject, JsonValue, MatchRecord } from '#lib/domain/records';

export interface MatchOption {
  key: string;
  values: Record<string, string | number>;
}
function object(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** Read the frozen configuration, never current catalog defaults or live score state. */
export function matchOptions(match: MatchRecord): MatchOption[] {
  const rules = match.rulesSnapshot.definition;
  const options: MatchOption[] = [
    { key: 'mode', values: { mode: match.mode } },
    {
      key: 'participants',
      values: { players: match.playersSnapshot.length, teams: match.teamsSnapshot.length },
    },
  ];
  const add = (key: string, values: MatchOption['values'] = {}) => options.push({ key, values });
  const number = (key: string, name: string, value: JsonValue | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value)) add(key, { [name]: value });
  };
  switch (match.rulesSnapshot.gameId) {
    case 'petanque':
      number('target', 'value', match.settingsSnapshot.target);
      number('boules', 'value', match.settingsSnapshot.boulesPerPlayer);
      if ((match.mode === 'teams' ? match.teamsSnapshot.length : match.playersSnapshot.length) > 2)
        add('freePlay');
      break;
    case 'yams':
      add('categories', { count: 13 });
      add('upperBonus', { enabled: rules.upperBonus === true ? 'yes' : 'no' });
      if (rules.engine === 'yams-turns13') {
        add('yamsTurnOrder');
        add('yamsFourKind', { mode: rules.fourKind === 'fixed40' ? 'fixed40' : 'sum' });
        add('yamsStraights', {
          small: rules.smallStraight as number,
          large: rules.largeStraight as number,
        });
        add('yamsExtraBonus', { enabled: rules.extraYamsBonus === true ? 'yes' : 'no' });
        add('yamsJoker', { enabled: rules.joker === true ? 'yes' : 'no' });
      }
      break;
    case '5000-10000':
      number('target', 'value', rules.target);
      number('entry', 'value', rules.entry);
      break;
    case 'darts': {
      if (rules.engine === 'cricket') {
        add('cricket');
        add('cricketPoints', { enabled: rules.points === true ? 'yes' : 'no' });
      } else {
        number('x01', 'value', rules.start);
        add('doubleOut', { enabled: rules.doubleOut === true ? 'yes' : 'no' });
      }
      const corkWinner = match.settingsSnapshot.dartsCorkWinnerId;
      if (typeof corkWinner === 'string') {
        const name =
          match.teamsSnapshot.find((team) => team.id === corkWinner)?.name ??
          match.playersSnapshot.find((player) => player.id === corkWinner)?.displayName;
        if (name) add('dartsCork', { name });
      }
      const series = object(match.settingsSnapshot.dartsMatch);
      number('legs', 'count', series.legsToWin);
      if (series.startingRule === 'alternate' || series.startingRule === 'loser')
        add('startingRule', { rule: series.startingRule });
      if ((match.mode === 'teams' ? match.teamsSnapshot.length : match.playersSnapshot.length) > 2)
        add('freePlay');
      break;
    }
    case '421':
      add('tokens', { count: 21 });
      break;
    case 'flip-7':
      add('target', { value: 200 });
      break;
    case 'skull-king':
      add('skullRounds', { count: 10 });
      add('skullScoring', { kind: String(rules.scoring) });
      if (rules.advancedCards) add('skullAdvanced');
      if (rules.expansion) add('skullExpansion');
      add('skullLoot', { enabled: rules.loot ? 'yes' : 'no' });
      break;
    case 'molkky':
      add('target', { value: 50 });
      break;
    case '6-qui-prend':
      add('sixExpansion', { kind: String(rules.expansion) });
      if (rules.expansion === 'surprises') add('rounds', { count: 2 });
      else add('bullheads', { count: 66 });
      if (rules.passCards) add('passCards');
      if (rules.variableRows) add('variableRows');
      break;
    case 'times-up':
      add('rounds', { count: 3 });
      add('duration', {
        seconds: rules.durationSeconds as number,
      });
      add('cards', { count: rules.cardCount as number });
      break;
    default:
      number('target', 'value', object(rules.objective).target);
      number('rounds', 'count', object(rules.turns).rounds);
  }
  return options;
}
