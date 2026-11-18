import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let server, browser;
try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const results = await page.evaluate(async () => {
    const [{ LocalDatabase }, { LocalRepository }, { presetParticipants }] = await Promise.all([
      import('/src/lib/storage/database.ts'),
      import('/src/lib/storage/repository.ts'),
      import('/src/lib/storage/preset-participants.ts'),
    ]);
    // Every record lives in this fresh context and dedicated disposable database.
    const db = new LocalDatabase(`scoretrackrr-benchmark-${crypto.randomUUID()}`);
    const repository = new LocalRepository(db),
      teamIds = [],
      at = new Date().toISOString();
    try {
      for (let n = 0; n < 16; n++) {
        const ids = [`member-${n}-a`, `member-${n}-b`];
        for (const id of ids)
          await repository.createPlayer({
            id,
            displayName: id,
            color: '#2459d3',
            isGuest: true,
            createdAt: at,
            updatedAt: at,
          });
        const id = `team-${n}`;
        teamIds.push(id);
        await repository.saveTeam(
          { id, name: id, color: '#2459d3', createdAt: at, updatedAt: at },
          ids,
        );
      }
      // Reference the previous sequential read pattern; production uses the batched loader.
      const sequential = async (ids) =>
        db.transaction('r', db.players, db.teams, db.teamMemberships, async () => {
          const rosters = [];
          for (const id of ids) {
            const team = await db.teams.get(id);
            const rows = (await db.teamMemberships.where('teamId').equals(id).toArray()).filter(
              (row) => !row.leftAt,
            );
            const memberIds = rows.map((row) => row.playerId);
            const members = await db.players.bulkGet(
              (team.memberOrder ?? [...memberIds].sort()).filter((id) => memberIds.includes(id)),
            );
            rosters.push({ team, members });
          }
          return { players: [], rosters };
        });
      const measure = async (fn) => {
        const start = performance.now();
        await fn();
        return performance.now() - start;
      };
      const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const output = [];
      for (const count of [1, 4, 16]) {
        const ids = teamIds.slice(0, count);
        if (
          JSON.stringify(await sequential(ids)) !==
          JSON.stringify(await presetParticipants(db, [], ids))
        )
          throw new Error('Roster results differ');
        for (let n = 0; n < 3; n++) {
          await sequential(ids);
          await presetParticipants(db, [], ids);
        }
        const before = [],
          after = [];
        for (let n = 0; n < 20; n++) {
          if (n % 2) {
            after.push(await measure(() => presetParticipants(db, [], ids)));
            before.push(await measure(() => sequential(ids)));
          } else {
            before.push(await measure(() => sequential(ids)));
            after.push(await measure(() => presetParticipants(db, [], ids)));
          }
        }
        output.push({
          teams: count,
          samples: 20,
          sequentialMedianMs: median(before),
          batchedMedianMs: median(after),
        });
      }
      return output;
    } finally {
      db.close();
      await db.delete();
    }
  });
  console.log(
    JSON.stringify(
      {
        runtime: 'Chromium native IndexedDB',
        browser: browser.version(),
        node: process.version,
        results,
      },
      null,
      2,
    ),
  );
  await context.close();
} finally {
  await browser?.close();
  await server?.close();
}
