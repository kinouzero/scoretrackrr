import { scoreSheets, type ScoreSheetId } from './score-sheets';
import type { GameVersionRecord } from '../records';

export function catalogGameId(version: GameVersionRecord): string {
  return version.gameId === 'darts' && version.definition.engine === 'cricket'
    ? 'cricket'
    : version.gameId;
}

export const gameCatalog = Object.freeze(
  (
    [
      ...(Object.keys(scoreSheets) as ScoreSheetId[]).map((id) => ({
        id,
        name: scoreSheets[id].name,
        symbol: '✦',
        state: 'available' as const,
      })),
      { id: 'times-up', name: 'Time’s Up!', symbol: '⌛', state: 'available' },
      { id: 'yams', name: 'Yams', symbol: '⚄', state: 'available' },
      { id: '421', name: '421', symbol: '⚂', state: 'available' },
      { id: '5000-10000', name: '5000 / 10000', symbol: '↗', state: 'available' },
      { id: '6-qui-prend', name: '6 qui prend !', symbol: '6', state: 'available' },
      { id: 'molkky', name: 'Mölkky', symbol: '♧', state: 'available' },
      { id: 'petanque', name: 'Pétanque', symbol: '◉', state: 'available' },
      { id: 'darts', name: 'X01', symbol: '◎', state: 'available' },
      { id: 'cricket', name: 'Cricket', symbol: '◎', state: 'available' },
      { id: 'skull-king', name: 'Skull King', symbol: '♜', state: 'available' },
      { id: 'flip-7', name: 'Flip 7', symbol: '7', state: 'available' },
    ] as const
  )
    .map((game) => Object.freeze(game))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
);
