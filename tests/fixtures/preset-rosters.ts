import { LocalDatabase } from '../../src/lib/storage/database';
import { LocalRepository } from '../../src/lib/storage/repository';
import { timestamp } from './journal';
export function countDatabaseReads(db: LocalDatabase) {
  let reads = 0;
  db.use({
    stack: 'dbcore',
    name: 'count-fixture-reads',
    create(core) {
      return {
        ...core,
        table(name) {
          const table = core.table(name);
          return {
            ...table,
            get(request) {
              reads++;
              return table.get(request);
            },
            getMany(request) {
              reads++;
              return table.getMany(request);
            },
            query(request) {
              reads++;
              return table.query(request);
            },
            openCursor(request) {
              reads++;
              return table.openCursor(request);
            },
            count(request) {
              reads++;
              return table.count(request);
            },
          };
        },
      };
    },
  });
  return {
    get reads() {
      return reads;
    },
    reset() {
      reads = 0;
    },
  };
}
export async function presetRosterFixture(teamCount: number) {
  const db = new LocalDatabase(crypto.randomUUID());
  const counter = countDatabaseReads(db);
  const repository = new LocalRepository(db);
  const teamIds: string[] = [];
  for (let team = 0; team < teamCount; team++) {
    const members = [`member-${team}-a`, `member-${team}-b`];
    for (const id of members)
      await repository.createPlayer({
        id,
        displayName: id,
        color: '#2459d3',
        isGuest: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    const id = `team-${team}`;
    teamIds.push(id);
    await repository.saveTeam(
      { id, name: id, color: '#2459d3', createdAt: timestamp, updatedAt: timestamp },
      members,
    );
  }
  counter.reset();
  return { db, counter, teamIds };
}
