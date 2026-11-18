import { createScoreSheetGame, isScoreSheet } from './score-sheets';
import type { GameVersionRecord } from '../records';
import { createDeclarativeGame } from '../engine/declarative';
import { createDartsMatchGame } from './darts-match';
import { createTimesUpGame } from './times-up';
import { createSixNimmtGame } from './six-nimmt';
import { createMolkkyGame } from './molkky';
import { createFlip7Game } from './flip7';
import { createSkullKingGame } from './skull-king';
import { createCricketGame } from './cricket';
import { createX01Game } from './darts';
import { createFarkleGame } from './farkle';
import { createFour21Game } from './four21';
import { createYamsGame } from './yams';

// Only trusted built-in modules are dispatched here; definitions cannot load external code.
export function createGame(version: GameVersionRecord, dartsMatch?: unknown) {
  if (isScoreSheet(version.gameId)) return createScoreSheetGame(version.gameId, version.definition);
  if (version.gameId === 'darts' && dartsMatch !== undefined)
    return createDartsMatchGame(version.definition, dartsMatch);
  if (version.gameId === 'darts')
    return version.definition.engine === 'cricket'
      ? createCricketGame(version.definition)
      : createX01Game(version.definition);
  if (version.gameId === 'times-up') return createTimesUpGame(version.definition);
  if (version.gameId === '6-qui-prend') return createSixNimmtGame(version.definition);
  if (version.gameId === 'molkky') return createMolkkyGame(version.definition);
  if (version.gameId === 'flip-7') return createFlip7Game(version.definition);
  if (version.gameId === 'skull-king') return createSkullKingGame(version.definition);
  if (version.gameId === '5000-10000') return createFarkleGame(version.definition);
  if (version.gameId === '421') return createFour21Game(version.definition);
  return version.gameId === 'yams'
    ? createYamsGame(version.definition)
    : createDeclarativeGame(version.definition);
}
