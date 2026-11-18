import { describe, expect, it } from 'vitest';
import { activeTeamPlayer } from '../../src/lib/domain/team-turn';
import type { GameVersionRecord, MatchRecord } from '../../src/lib/domain/records';
import type { AuditEntry, JournalAction } from '../../src/lib/domain/journal';
import { x01Version } from '../../src/lib/domain/games/darts';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { molkkyVersion } from '../../src/lib/domain/games/molkky';
import { timesUpVersion } from '../../src/lib/domain/games/times-up';
const timestamp = '2026-11-16T12:00:00.000Z';
function match(version: GameVersionRecord): MatchRecord {
  return {
    id: 'match',
    gameVersionId: version.id,
    organizerPlayerId: 'alice',
    mode: 'teams',
    status: 'in_progress',
    version: 0,
    settingsSnapshot: { engineConfig: { mode: 'teams', ownerIds: ['blue', 'red'] } },
    rulesSnapshot: version,
    playersSnapshot: ['alice', 'lucas', 'emma', 'hugo'].map((id) => ({
      id,
      displayName: id,
      color: '#153e35',
      isGuest: true,
    })),
    teamsSnapshot: [
      { id: 'blue', name: 'Blue', color: '#153e35', playerIds: ['alice', 'lucas'] },
      { id: 'red', name: 'Red', color: '#153e35', playerIds: ['emma', 'hugo'] },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
function entries(actions: JournalAction[]): AuditEntry[] {
  return actions.map((action, i) => ({
    action,
    event: {
      id: `event-${i}`,
      matchId: 'match',
      sequence: i + 1,
      commandId: `cmd-${i}`,
      actorPlayerId: 'alice',
      payload: {},
      timestamp,
    },
  }));
}
function score(
  ownerId: string,
  values: Record<string, number>,
): Extract<JournalAction, { type: 'record' }> {
  return { type: 'record', ownerId, values };
}
const dart = (ownerId = 'blue', sector = 0) => score(ownerId, { sector, multiplier: 1 });
const visit = (ownerId: string, total: number) => score(ownerId, { total, checkout: 0 });
describe('active team members', () => {
  it('rotates per Mölkky throw, independently for unequal rosters and skipped eliminated teams', () => {
    const base = match(molkkyVersion(timestamp));
    const value: MatchRecord = {
      ...base,
      settingsSnapshot: { engineConfig: { mode: 'teams', ownerIds: ['blue', 'red', 'green'] } },
      playersSnapshot: [
        ...base.playersSnapshot,
        { id: 'zoe', displayName: 'zoe', color: '#153e35', isGuest: true },
      ],
      teamsSnapshot: [
        ...base.teamsSnapshot,
        { id: 'green', name: 'Green', color: '#153e35', playerIds: ['zoe'] },
      ],
    };
    const owners = ['blue', 'red', 'green', 'blue', 'red', 'green', 'blue', 'red', 'green', 'red'];
    const actions = owners.map((id, turn) => score(id, { points: id === 'blue' ? 0 : 1, turn }));
    const unequal = {
      ...value,
      teamsSnapshot: value.teamsSnapshot.map((team) =>
        team.id === 'red' ? { ...team, playerIds: ['emma'] } : team,
      ),
    };
    expect(activeTeamPlayer(unequal, entries(actions), 'red')?.id).toBe('emma');
    expect(activeTeamPlayer(value, entries(actions.slice(0, -1)), 'red')?.id).toBe('hugo');
    expect(activeTeamPlayer(value, entries(actions), 'red')?.id).toBe('emma');
    expect(activeTeamPlayer(value, entries(actions), 'green')?.id).toBe('zoe');
  });
  it.each([x01Version(301, true, timestamp), cricketVersion(true, timestamp)])(
    'keeps all three darts with one member for $rulesetVersion',
    (version) => {
      const value = match(version);
      expect(activeTeamPlayer(value, [], 'blue')?.id).toBe('alice');
      expect(activeTeamPlayer(value, entries([dart(), dart()]), 'blue')?.id).toBe('alice');
      expect(activeTeamPlayer(value, entries([dart(), dart(), dart()]), 'blue')?.id).toBe('lucas');
      expect(activeTeamPlayer(value, entries([dart(), dart(), dart()]), 'red')?.id).toBe('emma');
    },
  );
  it('advances on aggregate visits and early busts rather than individual dart counts', () => {
    const value = match(x01Version(301, false, timestamp));
    const actions = [visit('blue', 180), visit('red', 0), visit('blue', 120), visit('red', 0)];
    expect(activeTeamPlayer(value, entries(actions), 'blue')?.id).toBe('alice');
    expect(activeTeamPlayer(value, entries([...actions, dart('blue', 20)]), 'blue')?.id).toBe(
      'lucas',
    );
  });
  it('continues member rotation across legs without counting the leg-start marker', () => {
    const base = match(x01Version(301, false, timestamp));
    const value = {
      ...base,
      settingsSnapshot: {
        ...base.settingsSnapshot,
        dartsMatch: { legsToWin: 2, startingRule: 'loser', firstStarterId: 'blue' },
      },
    };
    const actions = [visit('blue', 180), visit('red', 0), visit('blue', 121)];
    expect(activeTeamPlayer(value, entries(actions), 'red')?.id).toBe('hugo');
    actions.push(score('red', { nextLeg: 1 }));
    expect(activeTeamPlayer(value, entries(actions), 'red')?.id).toBe('hugo');
    expect(activeTeamPlayer(value, entries(actions), 'blue')?.id).toBe('alice');
    actions.push(visit('red', 0));
    expect(activeTeamPlayer(value, entries(actions), 'red')?.id).toBe('emma');
  });
  it('replays corrected and undone darts instead of counting audit entries', () => {
    const value = match(x01Version(301, true, timestamp));
    const actions: JournalAction[] = [dart(), dart(), dart()];
    actions.push({ type: 'correct', targetEventId: 'event-2', replacement: dart('blue', 20) });
    expect(activeTeamPlayer(value, entries(actions), 'blue')?.id).toBe('lucas');
    actions.push({ type: 'undo', targetEventId: 'event-3' });
    expect(activeTeamPlayer(value, entries(actions), 'blue')?.id).toBe('alice');
  });
  it('counts only scored Time’s Up! turns and preserves snapshot member order', () => {
    const value = match(timesUpVersion(timestamp));
    const actions = [
      score('blue', { kind: 0 }),
      score('blue', { kind: 1 }),
      score('blue', { kind: 3 }),
    ];
    expect(activeTeamPlayer(value, entries(actions), 'blue')?.id).toBe('alice');
    actions.push(score('blue', { kind: 2, points: 0 }));
    expect(activeTeamPlayer(value, entries(actions), 'blue')?.id).toBe('lucas');
    expect(
      activeTeamPlayer(
        {
          ...value,
          teamsSnapshot: [{ ...value.teamsSnapshot[0]!, playerIds: ['lucas', 'alice'] }],
        },
        [],
        'blue',
      )?.id,
    ).toBe('lucas');
  });
  it('omits individuals, Pétanque and missing historical members', () => {
    const value = match(molkkyVersion(timestamp));
    expect(activeTeamPlayer(value, [], 'alice')).toBeUndefined();
    expect(
      activeTeamPlayer(
        { ...value, rulesSnapshot: { ...value.rulesSnapshot, gameId: 'petanque' } },
        [],
        'blue',
      ),
    ).toBeUndefined();
    expect(activeTeamPlayer({ ...value, playersSnapshot: [] }, [], 'blue')).toBeUndefined();
    expect(
      activeTeamPlayer(
        { ...value, teamsSnapshot: [{ ...value.teamsSnapshot[0]!, playerIds: [] }] },
        [],
        'blue',
      ),
    ).toBeUndefined();
  });
});
