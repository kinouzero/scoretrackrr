import { describe, expect, it } from 'vitest';
import { ruleGuide, ruleSources, type RuleText } from '../../src/lib/application/rule-guide';
import { translate } from '../../src/lib/i18n/catalog';
import type { MatchRecord, GameVersionRecord, JsonObject } from '../../src/lib/domain/records';
import { petanqueVersion } from '../../src/lib/domain/games/petanque';
import {
  configuredYamsVersion,
  defaultYamsOptions,
  yamsVersion,
} from '../../src/lib/domain/games/yams';
import { farkleVersion } from '../../src/lib/domain/games/farkle';
import { four21Version } from '../../src/lib/domain/games/four21';
import { x01Version } from '../../src/lib/domain/games/darts';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { skullKingVersion } from '../../src/lib/domain/games/skull-king';
import { flip7Version } from '../../src/lib/domain/games/flip7';
import { molkkyVersion } from '../../src/lib/domain/games/molkky';
import { sixNimmtVersion } from '../../src/lib/domain/games/six-nimmt';
import { timesUpVersion } from '../../src/lib/domain/games/times-up';
import { counterDefinition } from '../../src/lib/domain/games/counter';
function match(version: GameVersionRecord, changes: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'rule-match',
    gameVersionId: version.id,
    rulesSnapshot: version,
    organizerPlayerId: 'alice',
    mode: 'individual',
    status: 'in_progress',
    version: 1,
    settingsSnapshot: {},
    playersSnapshot: ['alice', 'bob'].map((id) => ({
      id,
      displayName: id,
      color: '#153e35',
      isGuest: false,
    })),
    teamsSnapshot: [],
    createdAt: '2026-11-17T12:00:00.000Z',
    updatedAt: '2026-11-17T12:00:00.000Z',
    ...changes,
  };
}
const versions = [
  petanqueVersion(11, '', 'individual'),
  yamsVersion(false, ''),
  configuredYamsVersion(defaultYamsOptions, ''),
  four21Version(''),
  farkleVersion(5000, 0, ''),
  farkleVersion(10000, 500, ''),
  x01Version(301, true, ''),
  x01Version(501, false, ''),
  cricketVersion(true, ''),
  cricketVersion(false, ''),
  skullKingVersion(''),
  flip7Version(''),
  molkkyVersion(''),
  sixNimmtVersion(''),
  timesUpVersion(''),
];
const t = (item: RuleText, locale = 'fr') => translate(locale, item.key, item.values);
const messages = (guide: ReturnType<typeof ruleGuide>) => [
  guide.goal,
  ...guide.play,
  ...guide.scoring.flatMap((row) => [row.label, row.value]),
  ...guide.notes,
  ...guide.ending,
];
describe('saved-match rule guides', () => {
  it.each(versions.map((version) => [version.id, version] as const))(
    'localizes every section and verified source for %s',
    (id, version) => {
      const saved = match(version),
        before = JSON.stringify(saved);
      const guide = ruleGuide(saved);
      expect(guide.play.length).toBeGreaterThan(1);
      expect(guide.scoring.length).toBeGreaterThan(0);
      expect(guide.ending.length).toBeGreaterThan(0);
      expect(guide.sources.length).toBeGreaterThan(0);
      for (const locale of ['fr', 'en']) {
        for (const message of messages(guide))
          expect(t(message, locale)).not.toMatch(/undefined|NaN|UNKNOWN_MESSAGE|ruleGuide\./);
        for (const source of guide.sources)
          expect(translate(locale, `ruleGuide.sources.${source.key}`)).not.toBe('');
      }
      expect(JSON.stringify(saved)).toBe(before);
    },
  );
  it('shows saved Yams scoring and disabled options instead of current defaults', () => {
    const guide = ruleGuide(
      match(
        configuredYamsVersion(
          {
            ...defaultYamsOptions,
            upperBonus: false,
            fourKind: 'fixed40',
            smallStraight: 17,
            largeStraight: 58,
            extraYamsBonus: false,
            joker: false,
          },
          '',
        ),
      ),
    );
    expect(guide.scoring.map((row) => t(row.value))).toContain('17 points.');
    expect(guide.scoring.map((row) => t(row.value))).toContain('58 points.');
    expect(guide.scoring.map((row) => t(row.value))).toContain(
      '40 points, selon le paramètre choisi.',
    );
    expect(guide.notes.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'ruleGuide.yams.upperOff',
        'ruleGuide.yams.extraOff',
        'ruleGuide.yams.jokerOff',
      ]),
    );
    const old = ruleGuide(match(yamsVersion(true, '')));
    expect(old.play.map((item) => item.key)).toContain('ruleGuide.yams.legacy');
    expect(old.notes.map((item) => item.key)).toContain('ruleGuide.yams.jokerOff');
  });
  it('distinguishes the saved Farkle target and entry threshold', () => {
    const guide = ruleGuide(match(farkleVersion(5000, 0, '')));
    expect(guide.goal.values).toEqual({ target: 5000 });
    expect(guide.notes.find((item) => item.key === 'ruleGuide.farkle.entry')?.values).toEqual({
      entry: 0,
    });
    expect(guide.ending[0]?.values).toEqual({ target: 5000 });
  });
  it.each(['alternate', 'loser'])('describes frozen darts legs and %s starts', (startingRule) => {
    const guide = ruleGuide(
      match(x01Version(501, false, ''), {
        settingsSnapshot: { dartsMatch: { legsToWin: 5, startingRule, firstStarterId: 'bob' } },
      }),
    );
    expect(guide.goal.values).toEqual({ start: 501 });
    expect(guide.notes.map((item) => item.key)).toContain('ruleGuide.x01.straightOut');
    expect(guide.notes.map((item) => item.key)).toContain(`ruleGuide.dartsSeries.${startingRule}`);
    expect(guide.ending.at(-1)?.values).toEqual({ count: 5 });
  });
  it('identifies multiplayer extensions and keeps standard Petanque formats distinct', () => {
    const saved = match(petanqueVersion(13, '', 'individual'), {
      settingsSnapshot: { target: 11, boulesPerPlayer: 2 },
    });
    const playersSnapshot = [
      ...saved.playersSnapshot,
      { id: 'charlie', displayName: 'Charlie', color: '#153e35', isGuest: false },
    ];
    const guide = ruleGuide({ ...saved, playersSnapshot });
    expect(guide.goal.values).toEqual({ target: 11 });
    expect(guide.notes.map((item) => item.key)).toContain('ruleGuide.petanque.freePlay');
    expect(guide.notes.find((item) => item.key === 'ruleGuide.petanque.settings')?.values).toEqual({
      target: 11,
      boules: 2,
    });
    const darts = ruleGuide(match(cricketVersion(true, ''), { playersSnapshot }));
    expect(darts.notes.map((item) => item.key)).toContain('ruleGuide.dartsSeries.freePlay');
  });
  it('labels Charge21 scoring as a local table instead of attributing it to a universal rulebook', () => {
    const guide = ruleGuide(match(four21Version('')));
    expect(t(guide.notes.find((item) => item.key === 'ruleGuide.four21.house')!)).toContain(
      'barème local',
    );
    expect(guide.sources[0]?.key).toBe('abi');
  });
  it('shows custom field bounds and objectives without fabricating official references', () => {
    const definition = counterDefinition('custom-example', 'v1', {
      minimum: -10,
      maximum: 50,
      initialScore: 0,
      target: -5,
      direction: 'lowest',
    });
    const guide = ruleGuide(
      match({
        id: 'custom-example-v1',
        gameId: 'custom-example',
        rulesetVersion: 'v1',
        schemaVersion: 1,
        publishedAt: '',
        definition: definition as unknown as JsonObject,
      }),
    );
    expect(guide.id).toBe('custom');
    expect(guide.sources).toEqual([]);
    expect(guide.scoring[0]?.value.values).toEqual({ minimum: -10, maximum: 50 });
    expect(guide.notes.map((item) => item.key)).toContain('ruleGuide.custom.lowest');
    expect(guide.notes.find((item) => item.key === 'ruleGuide.custom.target')?.values).toEqual({
      target: -5,
    });
    for (const locale of ['fr', 'en'])
      for (const item of messages(guide)) expect(t(item, locale)).not.toContain('undefined');
  });
  it('keeps source URLs on their publisher or federation origins', () => {
    const hosts = new Set([
      'fipjp.org',
      'instructions.hasbro.com',
      'hasbro-new.custhelp.com',
      'www.playmonster.com',
      'www.abigames.fr',
      'www.thedra.co.uk',
      'ndadarts.com',
      'www.grandpabecksgames.com',
      'cdn.shopify.com',
      'www.gigamic.com',
      'cdn.svc.asmodee.net',
      'theop.games',
      'www.molkky.com',
      'ff-molkky.fr',
      'blog.amigo-spiele.de',
      'www.rprod.com',
    ]);
    for (const source of Object.values(ruleSources).flat()) {
      const url = new URL(source.url);
      expect(url.protocol).toBe('https:');
      expect(hosts.has(url.hostname)).toBe(true);
    }
  });
});
