import { describe, expect, it } from 'vitest';
import { matchOptions } from '../../src/lib/application/match-options';
import { translate } from '../../src/lib/i18n/catalog';
import type { GameVersionRecord, MatchRecord } from '../../src/lib/domain/records';
import { petanqueVersion } from '../../src/lib/domain/games/petanque';
import { yamsVersion } from '../../src/lib/domain/games/yams';
import { farkleVersion } from '../../src/lib/domain/games/farkle';
import { x01Version } from '../../src/lib/domain/games/darts';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { timesUpVersion } from '../../src/lib/domain/games/times-up';
import { molkkyVersion } from '../../src/lib/domain/games/molkky';
import { sixNimmtVersion } from '../../src/lib/domain/games/six-nimmt';
import { flip7Version } from '../../src/lib/domain/games/flip7';
import { skullKingVersion } from '../../src/lib/domain/games/skull-king';
import { four21Version } from '../../src/lib/domain/games/four21';

function match(version: GameVersionRecord, overrides: Partial<MatchRecord> = {}): MatchRecord {
  return {
    id: 'saved-match',
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
      color: '#2563eb',
      isGuest: false,
    })),
    teamsSnapshot: [],
    createdAt: '2026-11-16T12:00:00.000Z',
    updatedAt: '2026-11-16T12:00:00.000Z',
    ...overrides,
  };
}
function labels(saved: MatchRecord, locale = 'fr') {
  return matchOptions(saved).map((option) =>
    translate(locale, `matchOptions.${option.key}`, option.values),
  );
}

describe('saved match option presentation', () => {
  it('reads Pétanque target, boules and team composition from the frozen match', () => {
    const saved = match(petanqueVersion(11, '', 'teams'), {
      mode: 'teams',
      settingsSnapshot: { target: 11, boulesPerPlayer: 2 },
      playersSnapshot: ['alice', 'bob', 'cara', 'dan'].map((id) => ({
        id,
        displayName: id,
        color: '#2563eb',
        isGuest: false,
      })),
      teamsSnapshot: [
        { id: 'blue', name: 'Blue', color: '#2563eb', playerIds: ['alice', 'bob'] },
        { id: 'red', name: 'Red', color: '#dc2626', playerIds: ['cara', 'dan'] },
      ],
    });
    const before = structuredClone(saved);
    expect(labels(saved)).toEqual([
      'Par équipes',
      '4 joueurs · 2 équipes',
      'Objectif · 11 points',
      '2 boules par joueur',
    ]);
    expect(saved).toEqual(before);
  });
  it.each([false, true])('shows the actual Yams bonus selection: %s', (enabled) => {
    expect(labels(match(yamsVersion(enabled, '')))).toContain(
      enabled ? 'Prime supérieure · +35' : 'Sans prime supérieure',
    );
  });
  it.each([0, 500] as const)(
    'shows an absent or configured Farkle entry threshold: %s',
    (entry) => {
      const options = labels(match(farkleVersion(10000, entry, '')), 'en');
      expect(options).toContain('Target · 10,000 points');
      expect(options).toContain(
        entry === 0 ? 'No entry threshold' : 'Entry threshold · 500 points',
      );
    },
  );
  it('shows saved X01 and match-series settings without technical version identifiers', () => {
    const saved = match(x01Version(501, false, ''), {
      settingsSnapshot: {
        dartsMatch: { legsToWin: 5, startingRule: 'loser', firstStarterId: 'bob' },
      },
    });
    expect(labels(saved, 'en')).toEqual([
      'Individual',
      '2 players',
      'X01 · 501',
      'Straight-out',
      'First to 5 legs',
      'Previous loser starts',
    ]);
    expect(labels(saved, 'en').join(' ')).not.toContain(saved.rulesSnapshot.rulesetVersion);
  });
  it('keeps the saved best-of totals distinct from the win targets in mixed formats', () => {
    const saved = match(cricketVersion(true, ''), {
      settingsSnapshot: {
        dartsMatch: { legsToWin: 3, legsFormat: 'bestOf', setsToWin: 2 },
      },
    });
    expect(labels(saved)).toEqual(
      expect.arrayContaining(['Premier à 2 sets', 'Au meilleur de 5 legs par set']),
    );
    expect(labels(saved, 'en')).toContain('Best of 5 legs per set');
  });
  it.each([false, true])('distinguishes Cricket scoring from X01: %s', (points) => {
    const options = labels(match(cricketVersion(points, '')));
    expect(options).toContain('Cricket');
    expect(options).toContain(points ? 'Points classiques' : 'Sans points');
    expect(options.join(' ')).not.toContain('X01');
  });
  it('marks free play for more than two Pétanque sides', () => {
    const saved = match(petanqueVersion(13, '', 'individual'), {
      settingsSnapshot: { target: 13, boulesPerPlayer: 3 },
    });
    const player = { id: 'cara', displayName: 'Cara', color: '#2563eb', isGuest: false };
    expect(labels({ ...saved, playersSnapshot: [...saved.playersSnapshot, player] })).toContain(
      'Jeu libre',
    );
  });
  it.each([
    [timesUpVersion(''), ['3 manches', '30 s par tour', '40 cartes']],
    [molkkyVersion(''), ['Objectif · 50 points']],
    [sixNimmtVersion(''), ['Fin à 66 têtes de bœuf']],
    [flip7Version(''), ['Objectif · 200 points']],
    [skullKingVersion(''), ['10 manches + départage']],
    [four21Version(''), ['21 jetons']],
  ] as const)('localizes each fixed game configuration: %s', (version, expected) => {
    const saved = match(version);
    expect(labels(saved)).toEqual(expect.arrayContaining([...expected]));
    for (const label of labels(saved, 'en')) expect(label.length).toBeGreaterThan(0);
  });
  it('retains meaningful saved custom objectives and rounds', () => {
    const version = {
      ...yamsVersion(false, ''),
      gameId: 'custom-existing',
      name: 'My own rules',
      definition: { objective: { target: 42 }, turns: { rounds: 7 } },
    };
    expect(labels(match(version), 'en')).toEqual([
      'Individual',
      '2 players',
      'Target · 42 points',
      '7 rounds',
    ]);
  });
});
