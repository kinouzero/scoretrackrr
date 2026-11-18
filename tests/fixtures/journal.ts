import type { JsonObject } from '../../src/lib/domain/records';
import { LocalDatabase } from '../../src/lib/storage/database';
import { LocalRepository } from '../../src/lib/storage/repository';
export { LocalDatabase };
export { MatchJournal } from '../../src/lib/storage/journal';

export const timestamp = '2026-11-16T12:00:00.000Z';
export async function seedJournal(db: LocalDatabase, target: number | undefined = 13) {
  const repository = new LocalRepository(db);
  for (const id of ['alice', 'lucas', 'emma', 'hugo']) {
    await repository.createPlayer({
      id,
      displayName: id,
      color: '#153e35',
      isGuest: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  for (const [id, members] of [
    ['blue', ['alice', 'lucas']],
    ['red', ['emma', 'hugo']],
  ] as const) {
    await repository.saveTeam(
      { id, name: id, color: '#153e35', createdAt: timestamp, updatedAt: timestamp },
      members,
    );
  }
  await repository.saveGame({
    id: 'journal-fixture',
    slug: 'journal-fixture',
    name: 'Journal fixture',
    state: 'coming_soon',
  });
  const definition: JsonObject = {
    schemaVersion: 1,
    id: 'journal-fixture',
    rulesetVersion: '1',
    supportedModes: ['teams', 'individual', 'cooperative', 'mixed'],
    fields: [{ id: 'points', minimum: 0, maximum: 6, integer: true }],
    score: { op: 'input', field: 'points' },
    initialScore: 0,
    objective: { direction: 'highest', ...(target === undefined ? {} : { target }) },
    ties: 'shared',
  };
  await repository.publishGameVersion({
    id: 'fixture-v1',
    gameId: 'journal-fixture',
    rulesetVersion: '1',
    schemaVersion: 1,
    definition,
    publishedAt: timestamp,
  });
  return repository.createMatch({
    id: 'match',
    gameVersionId: 'fixture-v1',
    playerIds: ['alice', 'lucas', 'emma', 'hugo'],
    teamIds: ['blue', 'red'],
    organizerPlayerId: 'alice',
    mode: 'teams',
    settings: {},
    createdAt: timestamp,
  });
}
