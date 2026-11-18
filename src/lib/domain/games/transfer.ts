import { isScoreSheet } from './score-sheets';
import { EngineError } from '../engine/types';
import { copyBoundedJson, immutable } from '../engine/validation';
import type { GameVersionRecord, JsonObject } from '../records';
import { createGame } from './engine';
export interface GameTransfer {
  format: 'scoretrackrr-game';
  formatVersion: 1;
  name: string;
  gameId: string;
  rulesetVersion: string;
  schemaVersion: 1;
  definition: JsonObject;
}
export function decodeGameTransfer(text: string): Readonly<GameTransfer> {
  if (typeof text !== 'string' || text.length > 65536) throw new EngineError('input_limit');
  let input: GameTransfer;
  try {
    input = copyBoundedJson(JSON.parse(text)) as GameTransfer;
  } catch {
    throw new EngineError('invalid_rules');
  }
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).length !== 7 ||
    ![
      'format',
      'formatVersion',
      'name',
      'gameId',
      'rulesetVersion',
      'schemaVersion',
      'definition',
    ].every((key) => Object.hasOwn(input, key)) ||
    input.format !== 'scoretrackrr-game' ||
    input.formatVersion !== 1 ||
    input.schemaVersion !== 1 ||
    typeof input.name !== 'string' ||
    input.name.trim().length < 1 ||
    input.name.length > 120 ||
    /\p{Cc}/u.test(input.name) ||
    typeof input.gameId !== 'string' ||
    typeof input.rulesetVersion !== 'string'
  )
    throw new EngineError('invalid_rules');
  const game = createGame({
    id: 'transfer',
    gameId: input.gameId,
    rulesetVersion: input.rulesetVersion,
    schemaVersion: 1,
    publishedAt: '',
    definition: input.definition,
  });
  if (
    game.id !== input.gameId ||
    game.rulesetVersion !== input.rulesetVersion ||
    game.definition.schemaVersion !== input.schemaVersion
  )
    throw new EngineError('invalid_rules');
  if (
    !isScoreSheet(input.gameId) &&
    !input.gameId.startsWith('custom-') &&
    ![
      'yams',
      '421',
      '5000-10000',
      'petanque',
      'darts',
      'skull-king',
      'flip-7',
      'molkky',
      '6-qui-prend',
      'times-up',
    ].includes(input.gameId)
  )
    throw new EngineError('invalid_rules');
  return immutable({ ...input, name: input.name.trim() });
}
export function encodeGameTransfer(version: GameVersionRecord, name: string): string {
  const text = JSON.stringify(
    {
      format: 'scoretrackrr-game',
      formatVersion: 1,
      name,
      gameId: version.gameId,
      rulesetVersion: version.rulesetVersion,
      schemaVersion: version.schemaVersion,
      definition: version.definition,
    },
    null,
    2,
  );
  decodeGameTransfer(text);
  return text;
}
