import {
  scoreSheets,
  scoreSheetVersion,
  scoreSheetSpec,
  type ScoreSheetId,
} from '#lib/domain/games/score-sheets';
import type { GameVersionRecord } from '#lib/domain/records';
import type { JournalAction } from '#lib/domain/journal';
import { LocalDatabase } from '#lib/storage/database';
import { LocalRepository } from '#lib/storage/repository';
import { TeamRepository } from '#lib/storage/teams';
import { CatalogRepository } from '#lib/storage/catalog';
import { DeclarativeRepository } from '#lib/storage/declarative';
import { PetanqueRepository } from '#lib/storage/petanque';
import { MatchJournal } from '#lib/storage/journal';
import { petanqueVersion } from '#lib/domain/games/petanque';
import { yamsVersion } from '#lib/domain/games/yams';
import { four21Version } from '#lib/domain/games/four21';
import { farkleVersion } from '#lib/domain/games/farkle';
import { x01Version } from '#lib/domain/games/darts';
import { cricketVersion } from '#lib/domain/games/cricket';
import { skullKingVersion } from '#lib/domain/games/skull-king';
import { flip7Version } from '#lib/domain/games/flip7';
import { molkkyVersion } from '#lib/domain/games/molkky';
import { sixNimmtVersion } from '#lib/domain/games/six-nimmt';
import { timesUpVersion, timerClock } from '#lib/domain/games/times-up';

const sheetIds = Object.keys(scoreSheets) as ScoreSheetId[];
const prefix = 'local-demo-v1';
const players = ['Alice', 'Lucas', 'Emma', 'Hugo', 'Chloé', 'Noah'];
const colors = ['#2563eb', '#7c3aed', '#dc2626', '#ea580c', '#16a34a', '#0891b2'];
const avatars = ['sun', 'moon', 'star', 'leaf', 'dice', 'initials'] as const;
const teams = ['Les Bleus', 'Les Rouges', 'Les Verts'];
const playerId = (index: number) => `${prefix}-player-${index}`;
const teamId = (index: number) => `${prefix}-team-${index}`;
export const demoMatchIds = [
  'petanque-teams',
  'petanque-individual',
  'yams',
  '421',
  '5000',
  '10000',
  'darts-x01',
  'darts-cricket',
  'skull-king',
  'flip-7',
  'molkky-teams',
  'molkky-individual',
  '6-qui-prend',
  'times-up',
  ...sheetIds,
].map((id) => `${prefix}-${id}`);

interface Example {
  version: GameVersionRecord;
  mode: 'individual' | 'teams';
  owners: number;
  actions: (ids: string[], at: number) => JournalAction[];
}
const record = (ownerId: string, values: Record<string, number>): JournalAction => ({
  type: 'record',
  ownerId,
  values,
});
function examples(at: string): Example[] {
  const individual = (version: GameVersionRecord, actions: Example['actions']): Example => ({
    version,
    actions,
    mode: 'individual',
    owners: 4,
  });
  const team = (version: GameVersionRecord, actions: Example['actions'], owners = 2): Example => ({
    version,
    actions,
    mode: 'teams',
    owners,
  });
  const molkky: Example['actions'] = (ids) =>
    [10, 8, 12, 5, 7, 0].map((points, index) =>
      record(ids[index % ids.length]!, { points, turn: index }),
    );
  const farkle = (version: GameVersionRecord) =>
    individual(version, (ids) => [
      record(ids[0]!, { kind: 0, d1: 5, d2: 5, d3: 5, d4: 1, d5: 2, d6: 3, keep: 15 }),
      record(ids[0]!, { kind: 1 }),
    ]);
  return [
    team(petanqueVersion(13, at, 'teams'), (ids) => [
      record(ids[0]!, { kind: 0, points: 3, remainingFirst: 0, remainingSecond: 0 }),
      record(ids[1]!, { kind: 0, points: 2, remainingFirst: 0, remainingSecond: 0 }),
      record(ids[0]!, { kind: 0, points: 1, remainingFirst: 0, remainingSecond: 0 }),
    ]),
    individual(petanqueVersion(13, at, 'individual'), (ids) => [
      record(ids[0]!, { kind: 0, points: 2, remainingFirst: 0, remainingSecond: 0 }),
      record(ids[2]!, { kind: 0, points: 1, remainingFirst: 0, remainingSecond: 0 }),
    ]),
    individual(yamsVersion(true, at), (ids) =>
      ids.flatMap((id, index) => [
        record(id, { category: 0, points: index + 2 }),
        record(id, { category: 1, points: (index + 1) * 2 }),
      ]),
    ),
    individual(four21Version(at), (ids) =>
      [
        [4, 2, 1],
        [6, 6, 6],
        [3, 2, 1],
        [6, 5, 2],
      ].map((dice, index) =>
        record(ids[index]!, { d1: dice[0]!, d2: dice[1]!, d3: dice[2]!, throws: 1 }),
      ),
    ),
    farkle(farkleVersion(5000, 0, at)),
    farkle(farkleVersion(10000, 500, at)),
    team(x01Version(301, true, at), (ids) =>
      [0, 1].flatMap((index) =>
        Array.from({ length: 3 }, () =>
          record(ids[index]!, { sector: 20, multiplier: index === 0 ? 3 : 1 }),
        ),
      ),
    ),
    individual(cricketVersion(true, at), (ids) => [
      record(ids[0]!, { sector: 20, multiplier: 3 }),
      record(ids[0]!, { sector: 19, multiplier: 2 }),
      record(ids[0]!, { sector: 20, multiplier: 1 }),
      record(ids[1]!, { sector: 20, multiplier: 2 }),
    ]),
    individual(skullKingVersion(at), (ids) => [
      ...ids.map((id, index) => record(id, { round: 1, kind: 0, bid: index === 0 ? 1 : 0 })),
      ...ids.map((id, index) =>
        record(id, {
          round: 1,
          kind: 1,
          won: index === 0 ? 1 : 0,
          c14: 0,
          b14: 0,
          mermaids: 0,
          pirates: 0,
          king: 0,
        }),
      ),
    ]),
    individual(flip7Version(at), (ids) =>
      [
        [2, 5, 9],
        [3, 7, 11],
        [1, 4, 8],
        [6, 10, 12],
      ].map((cards, index) =>
        record(ids[index]!, {
          round: 1,
          cards: cards.reduce((mask, n) => mask | (1 << n), 0),
          modifiers: 0,
          double: 0,
          bust: 0,
        }),
      ),
    ),
    team(molkkyVersion(at), molkky, 3),
    individual(molkkyVersion(at), molkky),
    individual(sixNimmtVersion(at), (ids) =>
      ids.map((id, index) => record(id, { round: 1, points: [5, 12, 8, 3][index]! })),
    ),
    team(
      timesUpVersion(at),
      (ids, clock) => [
        record(ids[0]!, { kind: 0, turn: 0, ...timerClock(clock) }),
        record(ids[0]!, { kind: 2, turn: 0, points: 12, ...timerClock(clock + 30_000) }),
        record(ids[1]!, { kind: 0, turn: 1, ...timerClock(clock + 31_000) }),
        record(ids[1]!, { kind: 2, turn: 1, points: 9, ...timerClock(clock + 61_000) }),
      ],
      3,
    ),
    ...sheetIds.map((id): Example => {
      const spec = scoreSheetSpec(id);
      return {
        version: scoreSheetVersion(id, at),
        mode: spec.teams ? 'teams' : 'individual',
        owners: spec.min,
        actions: (ids) => [
          record(ids[0]!, {
            round: 1,
            end: 0,
            ...Object.fromEntries(
              ids.map((_, index) => [
                `p${index}`,
                id === 'tarot'
                  ? index === 0
                    ? 54
                    : -27
                  : id === 'uno'
                    ? index === 0
                      ? 45
                      : 0
                    : 20 + index * 5,
              ]),
            ),
          }),
        ],
      };
    }),
  ];
}

/** Explicit development-only fixture loading. Atomic, repeatable and additive. */
export async function seedDemoData(database: LocalDatabase, now = new Date()) {
  return database.transaction('rw', database.tables, async () => {
    const existing = await database.matches.bulkGet(demoMatchIds);
    if (existing.every(Boolean))
      return { created: false, players: 6, teams: 3, matches: demoMatchIds.length };
    if (
      existing.some(Boolean) ||
      (await database.players.bulkGet(players.map((_, i) => playerId(i)))).some(Boolean) ||
      (await database.teams.bulkGet(teams.map((_, i) => teamId(i)))).some(Boolean)
    )
      throw new Error('DEMO_ID_CONFLICT');
    const at = new Date(now.getTime() - 86_400_000).toISOString();
    const repository = new LocalRepository(database);
    await new CatalogRepository(database).initialize(at);
    for (const [index, name] of players.entries())
      await repository.createPlayer({
        id: playerId(index),
        displayName: `${name} · Démo`,
        color: colors[index]!,
        avatar: avatars[index]!,
        isGuest: false,
        createdAt: at,
        updatedAt: at,
      });
    const teamRepository = new TeamRepository(database);
    for (const [index, name] of teams.entries())
      await teamRepository.saveTeam(
        {
          id: teamId(index),
          name: `${name} · Démo`,
          color: colors[index * 2]!,
          avatar: 'flag',
          format: 'petanque_doublette',
          createdAt: at,
          updatedAt: at,
        },
        [playerId(index * 2), playerId(index * 2 + 1)],
        { create: true },
      );
    const deviceId = await database.readOrCreateDeviceId(crypto.randomUUID());
    const journal = new MatchJournal(database);
    for (const [index, example] of examples(at).entries()) {
      const id = demoMatchIds[index]!;
      const created = now.getTime() - (demoMatchIds.length - index) * 900_000;
      const createdAt = new Date(created).toISOString();
      const owners = Array.from({ length: example.owners }, (_, i) =>
        example.mode === 'teams' ? teamId(i) : playerId(i),
      );
      const references = await database.teams.bulkGet(example.mode === 'teams' ? owners : []);
      const base = {
        id,
        mode: example.mode,
        playerIds: example.mode === 'individual' ? owners : [],
        teams: references.map((team) => ({ id: team!.id, revision: team!.revision! })),
        organizerPlayerId: playerId(0),
        createdAt,
      };
      if (example.version.gameId === 'petanque')
        await new PetanqueRepository(database).create({
          ...base,
          target: 13,
          boulesPerPlayer: 3,
          firstThrowOwnerId: owners[0]!,
        });
      else
        await new DeclarativeRepository(database).create({
          ...base,
          versionId: example.version.id,
          cooperativeName: '',
          ...(index === 6
            ? {
                dartsMatch: {
                  legsToWin: 3,
                  startingRule: 'alternate' as const,
                  firstStarterId: owners[0]!,
                },
              }
            : {}),
        });
      const actions: JournalAction[] = [
        { type: 'start' },
        ...example.actions(owners, created + 1000),
      ];
      for (const [sequence, action] of actions.entries())
        await journal.submit({
          matchId: id,
          eventId: `${id}-event-${sequence}`,
          commandId: `${id}-command-${sequence}`,
          expectedVersion: sequence,
          actorPlayerId: playerId(0),
          deviceId,
          timestamp: new Date(created + (sequence + 1) * 60_000).toISOString(),
          action,
        });
    }
    return { created: true, players: 6, teams: 3, matches: demoMatchIds.length };
  });
}

export async function loadLocalDemo() {
  const database = new LocalDatabase();
  try {
    await seedDemoData(database);
  } finally {
    database.close();
  }
}
