import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { presetRosterFixture } from '../fixtures/preset-rosters';
import { presetParticipants } from '../../src/lib/storage/preset-participants';
import type { LocalDatabase } from '../../src/lib/storage/database';
const databases: LocalDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});
it.each([1, 4, 16])(
  'hydrates %i teams in bounded read operations and preserves requested/member order',
  async (count) => {
    const { db, counter, teamIds } = await presetRosterFixture(count);
    databases.push(db);
    await db.teams.update(teamIds[0]!, { memberOrder: ['member-0-b', 'member-0-a'] });
    counter.reset();
    const result = await presetParticipants(db, ['member-0-a'], [...teamIds].reverse());
    expect(result.players.map((player) => player.id)).toEqual(['member-0-a']);
    expect(result.rosters.map((roster) => roster.team.id)).toEqual([...teamIds].reverse());
    expect(result.rosters.at(-1)?.members.map((player) => player.id)).toEqual([
      'member-0-b',
      'member-0-a',
    ]);
    expect(counter.reads).toBeLessThanOrEqual(3);
  },
);
it('ignores historical memberships and rejects unavailable active members or teams', async () => {
  const { db, teamIds } = await presetRosterFixture(2);
  databases.push(db);
  const membership = await db.teamMemberships.where('teamId').equals(teamIds[0]!).first();
  await db.teamMemberships.update(membership!.id, { leftAt: '2026-11-17T12:00:00.000Z' });
  const result = await presetParticipants(db, [], teamIds);
  expect(result.rosters[0]?.members).toHaveLength(1);
  await db.players.update(result.rosters[0]!.members[0]!.id, {
    deletedAt: '2026-11-17T12:00:00.000Z',
  });
  await expect(presetParticipants(db, [], teamIds)).rejects.toMatchObject({
    code: 'missing_reference',
  });
  await db.teams.update(teamIds[1]!, { deletedAt: '2026-11-17T12:00:00.000Z' });
  await expect(presetParticipants(db, [], [teamIds[1]!])).rejects.toMatchObject({
    code: 'missing_reference',
  });
});
it('supports an empty draft without querying nonexistent team indexes', async () => {
  const { db } = await presetRosterFixture(1);
  databases.push(db);
  expect(await presetParticipants(db, [], [])).toEqual({ players: [], rosters: [] });
});
