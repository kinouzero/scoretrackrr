import { expect, type Page } from '@playwright/test';
import { normalizePlayerProfile } from '../../src/lib/domain/players';
import { normalizeTeamProfile } from '../../src/lib/domain/teams';
import type { PlayerRecord, TeamMembershipRecord, TeamRecord } from '../../src/lib/domain/records';

// Gameplay prerequisites only. Player and team editor scenarios exercise the real creation UI.
export async function seedPlayers(
  page: Page,
  names: readonly string[],
  rosters: Readonly<Record<string, readonly string[]>> = {},
) {
  const createdAt = new Date().toISOString();
  const records: PlayerRecord[] = names.map((displayName) => ({
    id: crypto.randomUUID(),
    ...normalizePlayerProfile({
      displayName,
      color: '#2459d3',
      isGuest: false,
      avatar: 'initials',
    }),
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  }));
  const playersByName = new Map(records.map((record) => [record.displayName, record.id]));
  const memberships: TeamMembershipRecord[] = [];
  const teams: TeamRecord[] = Object.entries(rosters).map(([name, members]) => {
    const id = crypto.randomUUID();
    const memberOrder = members.map((member) => {
      const playerId = playersByName.get(member);
      if (!playerId) throw new Error(`No player fixture for ${member}`);
      return playerId;
    });
    const profile = normalizeTeamProfile({ name, color: '#2459d3' }, memberOrder);
    for (const playerId of memberOrder) {
      memberships.push({ id: crypto.randomUUID(), teamId: id, playerId, joinedAt: createdAt });
    }
    return { ...profile, id, memberOrder, createdAt, updatedAt: createdAt, revision: 1 };
  });
  await page.goto('/players/');
  await expect(
    page.getByRole('button', { name: /^(Ajouter un joueur|Add player)$/, exact: true }),
  ).toBeEnabled();
  await page.evaluate(
    ({ records, teams, memberships }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('scoretrackrr');
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => {
          request.transaction?.abort();
          reject(new Error('Application schema must exist before installing player fixtures'));
        };
        request.onsuccess = () => {
          const db = request.result;
          const stores = teams.length ? ['players', 'teams', 'teamMemberships'] : ['players'];
          const transaction = db.transaction(stores, 'readwrite');
          for (const player of records) transaction.objectStore('players').add(player);
          for (const team of teams) transaction.objectStore('teams').add(team);
          for (const membership of memberships)
            transaction.objectStore('teamMemberships').add(membership);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
    { records, teams, memberships },
  );
  // Native fixture writes are visible to queries mounted after the next navigation.
  return records;
}
