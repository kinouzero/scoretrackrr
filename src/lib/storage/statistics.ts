import { LocalStatistics } from '#lib/domain/statistics';
import { matchesHistory, type HistoryFilters, type HistoryCursor } from '#lib/domain/history';
import type { MatchJournal } from './journal';
export async function calculateStatistics(
  journal: MatchJournal,
  filters: HistoryFilters,
  options: { signal?: AbortSignal; onProgress?: (processed: number) => void } = {},
) {
  const statistics = new LocalStatistics();
  let cursor: HistoryCursor | undefined,
    more = true,
    processed = 0;
  while (more) {
    if (options.signal?.aborted) throw new Error('STATS_CANCELLED');
    const page = await journal.history({ ...filters, status: 'finished' }, cursor);
    for (const record of page.items) {
      if (options.signal?.aborted) throw new Error('STATS_CANCELLED');
      const { match, journal: view } = await journal.inspect(record.id);
      if (view.projection.status === 'finished' && matchesHistory(match, filters))
        statistics.add(
          match,
          view.projection.totals,
          view.projection.winnerIds ?? (view.projection.winnerId ? [view.projection.winnerId] : []),
        );
      processed++;
      options.onProgress?.(processed);
    }
    more = page.hasMore;
    cursor = page.nextCursor;
  }
  return { ...statistics.result(), processed };
}
