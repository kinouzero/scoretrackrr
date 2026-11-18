import type { MatchRecord } from './records';
import { historyGameName } from './history';
export interface StatisticRow {
  gameId: string;
  versionId: string;
  gameName: string;
  rulesetVersion: string;
  versionName: string;
  publishedAt: string;
  ownerId: string;
  name: string;
  kind: 'player' | 'team';
  played: number;
  wins: number;
  total: number;
  best: number;
  average: number;
  rate: number;
}
export interface Confrontation {
  gameName: string;
  rulesetVersion: string;
  versionName: string;
  publishedAt: string;
  versionId: string;
  kind: 'player' | 'team';
  firstId: string;
  secondId: string;
  first: string;
  second: string;
  played: number;
  firstWins: number;
  secondWins: number;
}
export class LocalStatistics {
  private rows = new Map<string, StatisticRow>();
  private confrontations = new Map<string, Confrontation>();
  add(match: MatchRecord, totals: Readonly<Record<string, number>>, winnerIds: readonly string[]) {
    const owners = Object.keys(totals).map((id) => {
      const team = match.teamsSnapshot.find((team) => team.id === id);
      return {
        id,
        kind: team ? ('team' as const) : ('player' as const),
        name:
          team?.name ?? match.playersSnapshot.find((player) => player.id === id)?.displayName ?? id,
      };
    });
    const lowest =
      match.rulesSnapshot.definition.objective &&
      typeof match.rulesSnapshot.definition.objective === 'object' &&
      !Array.isArray(match.rulesSnapshot.definition.objective)
        ? 'direction' in match.rulesSnapshot.definition.objective &&
          match.rulesSnapshot.definition.objective.direction === 'lowest'
        : match.rulesSnapshot.definition.engine === 'x01' ||
          ['421', '6-qui-prend', 'skyjo'].includes(match.rulesSnapshot.gameId);
    for (const owner of owners) {
      const key = JSON.stringify([match.gameVersionId, owner.kind, owner.id]);
      const previous = this.rows.get(key);
      const played = (previous?.played ?? 0) + 1,
        wins = (previous?.wins ?? 0) + (winnerIds.includes(owner.id) ? 1 : 0),
        total = (previous?.total ?? 0) + totals[owner.id]!;
      this.rows.set(key, {
        gameId: match.rulesSnapshot.gameId,
        versionId: match.gameVersionId,
        gameName: historyGameName(match),
        rulesetVersion: match.rulesSnapshot.rulesetVersion,
        versionName: match.rulesSnapshot.name ?? match.rulesSnapshot.rulesetVersion,
        publishedAt: match.rulesSnapshot.publishedAt,
        ownerId: owner.id,
        name: owner.name,
        kind: owner.kind,
        played,
        wins,
        total,
        best: previous
          ? lowest
            ? Math.min(previous.best, totals[owner.id]!)
            : Math.max(previous.best, totals[owner.id]!)
          : totals[owner.id]!,
        average: total / played,
        rate: wins / played,
      });
    }
    if (owners.length === 2 && owners[0]!.kind === owners[1]!.kind) {
      const [a, b] = owners.sort((a, b) => a.id.localeCompare(b.id));
      const key = JSON.stringify([match.gameVersionId, a!.kind, a!.id, b!.id]);
      const previous = this.confrontations.get(key);
      this.confrontations.set(key, {
        gameName: historyGameName(match),
        rulesetVersion: match.rulesSnapshot.rulesetVersion,
        versionName: match.rulesSnapshot.name ?? match.rulesSnapshot.rulesetVersion,
        publishedAt: match.rulesSnapshot.publishedAt,
        versionId: match.gameVersionId,
        kind: a!.kind,
        firstId: a!.id,
        secondId: b!.id,
        first: a!.name,
        second: b!.name,
        played: (previous?.played ?? 0) + 1,
        firstWins: (previous?.firstWins ?? 0) + (winnerIds.includes(a!.id) ? 1 : 0),
        secondWins: (previous?.secondWins ?? 0) + (winnerIds.includes(b!.id) ? 1 : 0),
      });
    }
  }
  result() {
    return {
      rows: [...this.rows.values()].sort(
        (a, b) => a.gameName.localeCompare(b.gameName) || a.name.localeCompare(b.name),
      ),
      confrontations: [...this.confrontations.values()],
    };
  }
}
