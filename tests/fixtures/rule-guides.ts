import { seedDemoData, demoMatchIds } from '../../src/lib/development/demo';
import { LocalDatabase } from '../../src/lib/storage/database';
import { CatalogRepository } from '../../src/lib/storage/catalog';
import { DeclarativeRepository } from '../../src/lib/storage/declarative';
import { MatchJournal } from '../../src/lib/storage/journal';
import { yamsVersion, defaultYamsOptions } from '../../src/lib/domain/games/yams';

export async function seedRuleGuides() {
  const database = new LocalDatabase();
  try {
    await seedDemoData(database);
    const at = new Date().toISOString();
    const custom = await new CatalogRepository(database).publishCounter({
      gameId: 'custom-00000000-0000-4000-8000-000000000116',
      versionId: 'rules-custom-v1',
      rulesetVersion: 'rules-v1',
      name: 'Rules example',
      publishedAt: at,
      minimum: -10,
      maximum: 50,
      initialScore: 0,
      direction: 'highest',
      target: 30,
    });
    const examples = [
      {
        id: 'rules-modern-yams',
        versionId: yamsVersion(true, '').id,
        yamsOptions: {
          ...defaultYamsOptions,
          upperBonus: false,
          fourKind: 'fixed40' as const,
          smallStraight: 17,
          largeStraight: 58,
          joker: false,
        },
      },
      { id: 'rules-custom', versionId: custom.id },
    ];
    const deviceId = await database.readOrCreateDeviceId('rules-device');
    for (const item of examples) {
      const match = await new DeclarativeRepository(database).create({
        ...item,
        mode: 'individual',
        playerIds: ['local-demo-v1-player-0', 'local-demo-v1-player-1'],
        teams: [],
        organizerPlayerId: 'local-demo-v1-player-0',
        cooperativeName: '',
        createdAt: at,
      });
      await new MatchJournal(database).submit({
        matchId: match.id,
        eventId: `${match.id}-start`,
        commandId: `${match.id}-start`,
        actorPlayerId: match.organizerPlayerId,
        deviceId,
        timestamp: at,
        expectedVersion: 0,
        action: { type: 'start' },
      });
    }
    return [...demoMatchIds, ...examples.map((item) => item.id)];
  } finally {
    database.close();
  }
}
