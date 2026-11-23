import type { EngineState } from '../engine/types';
import type { AuditEntry } from '../journal';
import type { MatchRecord } from '../records';
import { scoreSlots } from '../score-slots';
import type { CheckoutDart } from './checkouts';
import { createCricketGame } from './cricket';
import { createDartsMatchGame } from './darts-match';
import { createX01Game } from './darts';

type Totals = { visits: number; points: number; best: number; busts: number; marks: number };
type Visit = {
  number: number;
  value: number;
  bust: boolean;
  darts: CheckoutDart[];
  total?: number;
};

export function dartsScorecard(match: MatchRecord, audit: readonly AuditEntry[]) {
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
  const sides = new Map(
    config.ownerIds.map((id) => [id, { count: 0, scored: 0, recent: [] as Visit[] }]),
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
  let visitMarks = 0;
  let darts: CheckoutDart[] = [];
  for (const { command } of scoreSlots(audit)) {
    if (!command) continue;
    for (const event of engine.decide(state, command, config)) {
      state = engine.evolve(state, event, config);
    }
    const next = leg(state);
    if (Object.hasOwn(command.values, 'nextLeg')) {
      for (const side of sides.values()) {
        side.count = 0;
        side.scored = 0;
        side.recent = [];
      }
    } else {
      const id = command.ownerId;
      const stats = totals.get(id)!;
      const delta = next.totals[id]! - previous.totals[id]!;
      visitPoints += cricket ? delta : -delta;
      if ('marks' in previous && 'marks' in next) {
        const before = previous.marks[id]!;
        const marks = next.marks[id]!.reduce(
          (sum, value, index) => sum + value - before[index]!,
          0,
        );
        stats.marks += marks;
        visitMarks += marks;
      }
      const { sector, multiplier, total } = command.values;
      if (sector !== undefined && multiplier !== undefined) darts.push({ sector, multiplier });
      if (next.dartsUsed === 0) {
        const bust = 'bust' in next && next.bust;
        const side = sides.get(id)!;
        const value = cricket && definition.points !== true ? visitMarks : visitPoints;
        side.count++;
        side.scored += value;
        side.recent.push({ number: side.count, value, bust, darts, total });
        if (side.recent.length > 3) side.recent.shift();
        stats.visits++;
        stats.points += visitPoints;
        stats.best = Math.max(stats.best, visitPoints);
        stats.busts += bust ? 1 : 0;
        visitPoints = 0;
        visitMarks = 0;
        darts = [];
      }
    }
    previous = next;
  }
  return { sides, darts, stats: [...totals].map(([id, stats]) => ({ id, ...stats })) };
}
