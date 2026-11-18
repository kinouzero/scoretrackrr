import { isDraftValue, isRecord, readPreference, writePreference } from './local-preferences';
export interface SetupPreset {
  id: string;
  name: string;
  gameId: string;
  options: Record<string, unknown>;
}
const key = 'scoretrackrr.setup-presets.v1';
export function isSetupPresets(value: unknown): value is SetupPreset[] {
  return (
    Array.isArray(value) &&
    value.length <= 40 &&
    new Set(value.map((item) => (isRecord(item) ? item.id : null))).size === value.length &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        item.id.length <= 128 &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0 &&
        item.name.length <= 60 &&
        typeof item.gameId === 'string' &&
        item.gameId.length <= 128 &&
        isRecord(item.options) &&
        isDraftValue(item.options),
    )
  );
}
export function readPresets(): SetupPreset[] {
  return readPreference(key, isSetupPresets) ?? [];
}
export function savePresets(items: SetupPreset[]): boolean {
  return isSetupPresets(items) && writePreference(key, items);
}
