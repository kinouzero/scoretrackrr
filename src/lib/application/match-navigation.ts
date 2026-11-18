import { getContext } from 'svelte';
import type { MatchRecord } from '#lib/domain/records';

export const matchNavigationContext = Symbol('match-navigation');
export interface MatchNavigation {
  readonly activeMatch: MatchRecord | undefined;
  readonly ready: boolean;
  returnToList(matchId: string): Promise<void>;
}
export function getMatchNavigation(): MatchNavigation {
  return getContext<MatchNavigation>(matchNavigationContext);
}
