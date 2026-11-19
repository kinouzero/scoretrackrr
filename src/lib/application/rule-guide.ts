import { isScoreSheet, scoreSheetSpec, type ScoreSheetId } from '#lib/domain/games/score-sheets';
import { skullCards } from '#lib/domain/games/skull-king';
import type { JsonObject, JsonValue, MatchRecord } from '#lib/domain/records';

export interface RuleText {
  key: string;
  values?: Record<string, string | number>;
}
export interface RuleSource {
  key: string;
  url: string;
}
export interface RuleGuide {
  id: string;
  goal: RuleText;
  play: RuleText[];
  scoring: { label: RuleText; value: RuleText }[];
  notes: RuleText[];
  ending: RuleText[];
  sources: readonly RuleSource[];
}
export const RULES_REVIEWED_AT = '2026-11-18';
export const ruleSources = {
  petanque: [
    {
      key: 'fipjp',
      url: 'https://fipjp.org/images/2021/reglements/REGLEMENT-OFFICIEL-SPORT-PETANQUE.pdf',
    },
  ],
  yams: [
    { key: 'hasbro', url: 'https://instructions.hasbro.com/api/download/C2406_en-us_yahtzee.pdf' },
    {
      key: 'hasbroJoker',
      url: 'https://hasbro-new.custhelp.com/app/answers/detail_uk/a_id/211/kw/Sheets%20for%20clue',
    },
  ],
  farkle: [
    {
      key: 'playmonster',
      url: 'https://www.playmonster.com/wp-content/uploads/2018/06/Farkle-Rules.pdf',
    },
  ],
  four21: [
    {
      key: 'abi',
      url: 'https://www.abigames.fr/nos-jeux-de-societe/acheter-trilogy-dice-451-5000-yams-avec-piste-de-des-incluse/433',
    },
  ],
  x01: [{ key: 'dra', url: 'https://www.thedra.co.uk/dra-rulebook' }],
  cricket: [{ key: 'nda', url: 'https://ndadarts.com/nda-rules/' }],
  skull: [
    { key: 'grandpa', url: 'https://www.grandpabecksgames.com/pages/skull-king' },
    { key: 'skullExpansion', url: 'https://www.grandpabecksgames.com/pages/skull-king-expansion' },
    {
      key: 'rascal',
      url: 'https://cdn.shopify.com/s/files/1/0565/3230/4053/files/Skull_King_Rascal_Scoring.pdf?v=1784153921',
    },
  ],
  flip: [
    {
      key: 'flip31',
      url: 'https://cdn.svc.asmodee.net/production-asmodeeca/uploads/2025/12/FLIP_7-RULES.pdf',
    },
    { key: 'flipFaq', url: 'https://theop.games/pages/flip-7-faqs' },
  ],
  molkky: [
    { key: 'molkky', url: 'https://www.molkky.com/game/rules/' },
    { key: 'ffm', url: 'https://ff-molkky.fr/regles/' },
  ],
  six: [
    {
      key: 'sixJokers',
      url: 'https://www.gigamic.com/index.php?controller=attachment&id_attachment=177',
    },
    {
      key: 'sixSurprises',
      url: 'https://www.gigamic.com/index.php?controller=attachment&id_attachment=200',
    },
    { key: 'amigo', url: 'https://blog.amigo-spiele.de/content/ap/rule/04910-GB-AmigoRule.pdf' },
  ],
  timesUp: [
    { key: 'repos', url: 'https://www.rprod.com/fr/games/times-up-party' },
    {
      key: 'party',
      url: 'https://cdn.svc.asmodee.net/production-rprod/storage/downloads/games/times-up-party/tup-party-rules-en-uk-1631177413p06DF.pdf',
    },
  ],
} as const satisfies Record<string, readonly RuleSource[]>;

function object(value: JsonValue | undefined): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}
function number(value: JsonValue | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const sheetSources: Record<ScoreSheetId, readonly RuleSource[]> = {
  skyjo: [
    {
      key: 'sheet-skyjo',
      url: 'https://magilano.com/pages/download',
    },
  ],
  belote: [
    {
      key: 'sheet-belote',
      url: 'https://www.ffbelote.org/reglements-de-la-belote-avec-ou-sans-annonce/',
    },
    { key: 'sheet-coinche', url: 'https://www.ffbelote.org/regles-coinche/' },
  ],
  tarot: [{ key: 'sheet-tarot', url: 'https://fftarot.fr/assets/documents/Reglement%20FFT.pdf' }],
  rummy: [{ key: 'sheet-rummy', url: 'https://bicyclecards.com/how-to-play/rummy-rum/' }],
  uno: [
    { key: 'sheet-uno', url: 'https://service.mattel.com/instruction_sheets/W2085.pdf' },
    {
      key: 'sheet-unoFlip',
      url: 'https://service.mattel.com/instruction-sheets/files/GDR44%20UNO%20Flip%5BEnglish_French_German_Spanish_Portuguese%5D%5B5LG%5D.pdf',
    },
  ],
  scrabble: [{ key: 'sheet-scrabble', url: 'https://www.ffsc.fr/classique.php?page=reglements' }],
  'seven-wonders': [
    { key: 'sheet-seven-wonders', url: 'https://www.rprod.com/en/games/7-wonders' },
  ],
  qwixx: [
    {
      key: 'sheet-qwixx',
      url: 'https://www.gigamic.com/jeux-de-voyage/155-qwixx-3421272110421.html',
    },
  ],
  clever: [
    {
      key: 'sheet-clever',
      url: 'https://www.schmidtspiele.de/files/Retail/72dpi_PNG/88190_Tres_Fute_FR.pdf',
    },
  ],
  dominoes: [
    { key: 'sheet-dominoes', url: 'https://zimad.helpshift.com/hc/en/7-domino/faq/39-block-game/' },
  ],
};

/** Describe the played snapshot; current catalog defaults never alter historical rules. */
export function ruleGuide(match: MatchRecord): RuleGuide {
  const sheetId = match.rulesSnapshot.gameId;
  if (isScoreSheet(sheetId)) {
    const spec = scoreSheetSpec(sheetId);
    return {
      id: sheetId,
      goal: { key: spec.lowest ? 'scoreSheet.lowest' : 'scoreSheet.highest' },
      play: [{ key: `scoreSheet.${sheetId}.hint` }],
      scoring: [
        { label: { key: 'scoreSheet.points' }, value: { key: `scoreSheet.${sheetId}.scoring` } },
      ],
      notes: [],
      ending: [
        spec.target
          ? { key: 'scoreSheet.threshold', values: { target: spec.target } }
          : { key: spec.final ? 'scoreSheet.finalEnd' : 'scoreSheet.manualEnd' },
      ],
      sources: sheetSources[sheetId],
    };
  }
  const rules = match.rulesSnapshot.definition;
  const text = (key: string, values?: RuleText['values']): RuleText => ({
    key: `ruleGuide.${key}`,
    ...(values ? { values } : {}),
  });
  let id: keyof typeof ruleSources | 'custom';
  switch (match.rulesSnapshot.gameId) {
    case 'petanque':
      id = 'petanque';
      break;
    case 'yams':
      id = 'yams';
      break;
    case '5000-10000':
      id = 'farkle';
      break;
    case '421':
      id = 'four21';
      break;
    case 'darts':
      id = rules.engine === 'cricket' ? 'cricket' : 'x01';
      break;
    case 'skull-king':
      id = 'skull';
      break;
    case 'flip-7':
      id = 'flip';
      break;
    case 'molkky':
      id = 'molkky';
      break;
    case '6-qui-prend':
      id = 'six';
      break;
    case 'times-up':
      id = 'timesUp';
      break;
    default:
      id = 'custom';
  }
  const guide: RuleGuide = {
    id,
    goal: text(`${id}.goal`),
    play: [],
    scoring: [],
    notes: [],
    ending: [],
    sources: id === 'custom' ? [] : ruleSources[id],
  };
  const play = (...keys: string[]) => guide.play.push(...keys.map((key) => text(`${id}.${key}`)));
  const note = (key: string, values?: RuleText['values']) =>
    guide.notes.push(text(`${id}.${key}`, values));
  const end = (key: string, values?: RuleText['values']) =>
    guide.ending.push(text(`${id}.${key}`, values));
  const row = (key: string, values?: RuleText['values']) =>
    guide.scoring.push({
      label: text(`${id}.${key}.label`),
      value: text(`${id}.${key}.value`, values),
    });
  switch (id) {
    case 'petanque': {
      const target = number(
        match.settingsSnapshot.target,
        number(object(rules.objective).target, 13),
      );
      guide.goal = text('petanque.goal', { target });
      play('start', 'turn', 'measure');
      row('point');
      row('deadOne');
      row('deadBoth');
      note('settings', { target, boules: number(match.settingsSnapshot.boulesPerPlayer, 3) });
      note('format');
      if ((match.mode === 'teams' ? match.teamsSnapshot.length : match.playersSnapshot.length) > 2)
        note('freePlay');
      end('finish', { target });
      end('next');
      break;
    }
    case 'yams': {
      play('roll', 'choose', rules.engine === 'yams-turns13' ? 'turns' : 'legacy');
      row('upper');
      row('three');
      row(rules.fourKind === 'fixed40' ? 'fourFixed' : 'fourSum');
      row('full');
      row('small', { points: number(rules.smallStraight, 30) });
      row('large', { points: number(rules.largeStraight, 40) });
      row('five');
      row('chance');
      note(rules.upperBonus === true ? 'upperOn' : 'upperOff');
      note(rules.extraYamsBonus === true ? 'extraOn' : 'extraOff');
      note(rules.joker === true ? 'jokerOn' : 'jokerOff');
      note('settings');
      end('finish');
      break;
    }
    case 'farkle': {
      const target = number(rules.target, 10000),
        entry = number(rules.entry, 500);
      guide.goal = text('farkle.goal', { target });
      play('roll', 'keep', 'risk');
      for (const key of [
        'one',
        'five',
        'triples',
        'four',
        'fiveKind',
        'sixKind',
        'special',
        'twoTriples',
      ])
        row(key);
      note('entry', { entry });
      note('settings', { target });
      end('finish', { target });
      break;
    }
    case 'four21':
      play('charge', 'discharge', 'starter');
      for (const key of ['421', 'ones', 'pairs', 'triples', 'straight', 'ordinary', 'nenette'])
        row(key);
      note('ranking');
      note('house');
      note('tie');
      end('finish');
      break;
    case 'x01':
      guide.goal = text('x01.goal', { start: number(rules.start, 301) });
      play('turn', 'subtract');
      for (const key of ['single', 'double', 'triple', 'bull', 'miss']) row(key);
      note(rules.doubleOut === true ? 'doubleOut' : 'straightOut');
      note('entry');
      end('finish');
      break;
    case 'cricket':
      play('targets', 'turn', 'close');
      row('marks');
      row('bull');
      row('other');
      note(rules.points === true ? 'pointsOn' : 'pointsOff');
      end(rules.points === true ? 'finishPoints' : 'finishNoPoints');
      break;
    case 'skull':
      guide.play.push(
        text('skull.deal', {
          maxCards: skullCards(10, Math.max(1, match.playersSnapshot.length), {
            advancedCards: rules.advancedCards === true,
            expansion: rules.expansion === true,
            loot: rules.loot === true,
            scoring: rules.scoring === 'rascal' ? 'rascal' : 'classic',
          }),
        }),
      );
      play('bid', 'tricks', 'record');
      for (const key of [
        'exact',
        'miss',
        'zero',
        'zeroMiss',
        'fourteen',
        'mermaid',
        'pirate',
        'king',
      ])
        row(key);
      if (rules.scoring !== 'rascal') note('bonuses');
      if (!rules.advancedCards && !rules.expansion && !rules.loot && rules.scoring !== 'rascal')
        note('edition');
      if (rules.scoring === 'rascal') {
        guide.scoring = guide.scoring.slice(4);
        note('rascal');
      }
      if (rules.advancedCards) note('advanced');
      if (rules.expansion) note('expansion');
      if (rules.loot) note('loot');
      end('finish');
      break;
    case 'flip':
      play('deal', 'choice', 'duplicate', 'seven');
      row('numbers');
      row('double');
      row('modifiers');
      row('bonus');
      row('bust');
      note('actions');
      end('finish');
      break;
    case 'molkky':
      play('setup', 'throw', 'raise');
      row('single');
      row('several');
      row('miss');
      note('over');
      note('elimination');
      note('team');
      end('finish');
      break;
    case 'six':
      play(
        rules.expansion === 'surprises' ? 'surprisesDeal' : 'deal',
        'choose',
        'place',
        'small',
        'sixth',
      );
      if (rules.expansion === 'jokers') note('jokers');
      if (rules.passCards) note('passCards');
      if (rules.variableRows) note('variableRows');
      row('ordinary');
      row('five');
      row('ten');
      row('eleven');
      row('55');
      if (rules.expansion === 'surprises') note('surprisesRecord');
      else note('record', { cards: rules.expansion === 'jokers' ? 11 : 10 });
      end(rules.expansion === 'surprises' ? 'surprisesFinish' : 'finish');
      break;
    case 'timesUp':
      guide.play.push(text('timesUp.setup', { cards: rules.cardCount as number }));
      guide.play.push(text('timesUp.timer', { seconds: rules.durationSeconds as number }));
      play('rotate');
      row('free');
      row('word');
      row('mime');
      row('point');
      note('forbidden');
      note('answers');
      note('timerChoice');
      end('finish');
      break;
    case 'custom': {
      play('entry', 'saved');
      if (Array.isArray(rules.fields))
        for (const field of rules.fields) {
          const data = object(field);
          if (typeof data.id === 'string')
            guide.scoring.push({
              label: text('custom.field', { name: data.id }),
              value: text('custom.range', {
                minimum: number(data.minimum, 0),
                maximum: number(data.maximum, 0),
              }),
            });
        }
      const objective = object(rules.objective);
      note(objective.direction === 'lowest' ? 'lowest' : 'highest');
      if (typeof objective.target === 'number') note('target', { target: objective.target });
      const rounds = object(rules.turns);
      if (typeof rounds.rounds === 'number') note('rounds', { count: rounds.rounds });
      end(rules.ties === 'continue' ? 'continue' : 'shared');
      break;
    }
  }
  if (id === 'x01' || id === 'cricket') {
    if (typeof match.settingsSnapshot.dartsCorkWinnerId === 'string') {
      guide.play.unshift(text('dartsCork.play'));
      guide.notes.push(text('dartsCork.tie'));
      guide.sources = [
        ...guide.sources,
        {
          key: 'ndfc',
          url: 'https://www.ndfc.ca/news/149532/NEW-NDFC-BULL-RULE-EFFECTIVE-IMMEDIATELY',
        },
      ];
    }
    const series = object(match.settingsSnapshot.dartsMatch);
    if (typeof series.legsToWin === 'number') {
      guide.ending.push(
        typeof series.setsToWin === 'number'
          ? text('dartsSeries.sets', { legs: series.legsToWin, sets: series.setsToWin })
          : text('dartsSeries.win', { count: series.legsToWin }),
      );
      guide.notes.push(
        text(series.startingRule === 'loser' ? 'dartsSeries.loser' : 'dartsSeries.alternate'),
      );
    }
    if ((match.mode === 'teams' ? match.teamsSnapshot.length : match.playersSnapshot.length) > 2)
      guide.notes.push(text('dartsSeries.freePlay'));
  }
  return guide;
}
