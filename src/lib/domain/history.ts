import type { MatchRecord } from './records';
import { gameCatalog } from './games/catalog';
export interface HistoryFilters {
  search?: string;
  game?: string;
  player?: string;
  team?: string;
  status?: string;
  variant?: string;
  from?: string;
  until?: string;
}
const gameSearchAliases: ReadonlyMap<string, string> = new Map([
  ['6-qui-prend', '6 nimmt'],
  ['darts', 'fléchettes'],
]);

function normalizeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matchesSearch(match: MatchRecord, search?: string): boolean {
  const terms = normalizeSearch(search ?? '')
    .split(' ')
    .filter(Boolean);
  if (terms.length === 0) return true;
  const text = normalizeSearch(
    [
      historyGameName(match),
      match.rulesSnapshot.name ?? '',
      match.rulesSnapshot.gameId,
      gameSearchAliases.get(match.rulesSnapshot.gameId) ?? '',
      ...match.playersSnapshot.map((player) => player.displayName),
      ...match.teamsSnapshot.map((team) => team.name),
    ].join(' '),
  );
  return terms.every((term) => text.includes(term));
}
export interface HistoryCursor {
  createdAt: string;
  id: string;
}
export function historyGameName(match: MatchRecord) {
  return (
    gameCatalog.find((game) => game.id === match.rulesSnapshot.gameId)?.name ??
    match.rulesSnapshot.name ??
    match.rulesSnapshot.gameId
  );
}
export function matchesHistory(match: MatchRecord, filters: HistoryFilters) {
  const includes = (text: string, query?: string) =>
    !query || text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  return (
    matchesSearch(match, filters.search) &&
    includes(historyGameName(match), filters.game) &&
    includes(
      `${match.rulesSnapshot.name ?? ''} ${match.rulesSnapshot.rulesetVersion}`,
      filters.variant,
    ) &&
    (!filters.player ||
      match.playersSnapshot.some((player) => includes(player.displayName, filters.player))) &&
    (!filters.team || match.teamsSnapshot.some((team) => includes(team.name, filters.team))) &&
    (!filters.status || match.status === filters.status) &&
    (!filters.from || match.createdAt >= filters.from) &&
    (!filters.until || match.createdAt < filters.until)
  );
}
