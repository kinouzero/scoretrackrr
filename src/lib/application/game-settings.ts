import type { GameVersionRecord, JsonValue } from '#lib/domain/records';

export const x01StartingScores: readonly number[] = [101, 201, 301, 401, 501, 601, 701];
export function initialX01Start(value: unknown): number {
  return typeof value === 'number' && x01StartingScores.includes(value) ? value : 301;
}

export type GameSetting =
  'upperBonus' | 'target10000' | 'entry500' | 'cricket' | 'doubleOut' | 'cricketPoints';
export function gameSettings(
  version: GameVersionRecord,
): readonly { key: GameSetting; enabled: boolean }[] {
  const rules = version.definition;
  if (version.gameId === 'yams') return [{ key: 'upperBonus', enabled: rules.upperBonus === true }];
  if (version.gameId === '5000-10000')
    return [
      { key: 'target10000', enabled: rules.target === 10000 },
      { key: 'entry500', enabled: rules.entry === 500 },
    ];
  if (version.gameId === 'darts')
    return rules.engine === 'cricket'
      ? [
          { key: 'cricket', enabled: true },
          { key: 'cricketPoints', enabled: rules.points === true },
        ]
      : [
          { key: 'cricket', enabled: false },
          { key: 'doubleOut', enabled: rules.doubleOut === true },
        ];
  return [];
}
export function versionForSetting(
  current: GameVersionRecord,
  versions: readonly GameVersionRecord[],
  key: GameSetting,
  enabled: boolean,
): GameVersionRecord | undefined {
  if (!gameSettings(current).some((setting) => setting.key === key)) return undefined;
  const rules = current.definition;
  let desired: Record<string, JsonValue>;
  if (current.gameId === 'yams') desired = { upperBonus: enabled };
  else if (current.gameId === '5000-10000')
    desired = {
      target: key === 'target10000' ? (enabled ? 10000 : 5000) : rules.target!,
      entry: key === 'entry500' ? (enabled ? 500 : 0) : rules.entry!,
    };
  else if (key === 'cricket')
    desired = enabled
      ? { engine: 'cricket', points: true }
      : { engine: 'x01', start: 301, doubleOut: true };
  else if (rules.engine === 'cricket') desired = { engine: 'cricket', points: enabled };
  else
    desired = {
      engine: 'x01',
      start: rules.start!,
      doubleOut: key === 'doubleOut' ? enabled : rules.doubleOut!,
    };
  const exact = versions.find(
    (version) =>
      version.gameId === current.gameId &&
      Object.entries(desired).every(([field, value]) => version.definition[field] === value),
  );
  if (exact) return exact;
  // The numeric draft belongs to setup; use a registered checkout preset if needed.
  if (key === 'doubleOut' && current.gameId === 'darts' && rules.engine === 'x01')
    return versions.find(
      (version) =>
        version.gameId === 'darts' &&
        version.definition.engine === 'x01' &&
        version.definition.doubleOut === enabled,
    );
  return undefined;
}
