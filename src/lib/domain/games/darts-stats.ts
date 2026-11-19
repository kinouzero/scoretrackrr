import type { EngineState } from '../engine/types';
import type { AuditEntry } from '../journal';
import type { MatchRecord } from '../records';
import { scoreSlots } from '../score-slots';
import { createCricketGame } from './cricket';
import { createDartsMatchGame } from './darts-match';
import { createX01Game } from './darts';

type Totals = { visits: number; points: number; best: number; busts: number; marks: number };

export function dartsStats(match: MatchRecord, audit: readonly AuditEntry[]) {
  const definition = match.rulesSnapshot.definition;
  const cricket = definition.engine === 'cricket';
  const base = cricket ? createCricketGame(definition) : createX01Game(definition);
  const options = match.settingsSnapshot.dartsMatch;
  const series = options === undefined ? undefined : createDartsMatchGame(definition, options);
  const engine = series ?? base;
  const config = engine.validateConfig(match.settingsSnapshot.engineConfig);
  const totals = new Map<string, Totals>(
    config.ownerIds.map((id) => [id, { visits: 0, points: 0, best: 0, busts: 0, marks: 0 }]),
  );

  function leg(state: EngineState) {
    return base.inspect(
      series ? series.inspect(state, config).legState : state,
      series?.getLegConfig(state, config) ?? config,
    );
  }

  let state = engine.initialState(config);
  let previous = leg(state);
  let visitPoints = 0;
  for (const { command } of scoreSlots(audit)) {
    if (!command) continue;
    for (const event of engine.decide(state, command, config)) {
      state = engine.evolve(state, event, config);
    }
    const next = leg(state);
    if (!Object.hasOwn(command.values, 'nextLeg')) {
      const id = command.ownerId;
      const stats = totals.get(id)!;
      const delta = next.totals[id]! - previous.totals[id]!;
      visitPoints += cricket ? delta : -delta;
      if ('marks' in previous && 'marks' in next) {
        const before = previous.marks[id]!;
        stats.marks += next.marks[id]!.reduce(
          (sum, value, index) => sum + value - before[index]!,
          0,
        );
      }
      if (next.dartsUsed === 0) {
        stats.visits++;
        stats.points += visitPoints;
        stats.best = Math.max(stats.best, visitPoints);
        stats.busts += 'bust' in next && next.bust ? 1 : 0;
        visitPoints = 0;
      }
    }
    previous = next;
  }
  return [...totals].map(([id, stats]) => ({ id, ...stats }));
}
