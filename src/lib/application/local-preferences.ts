// Optional device preferences never replace authoritative match records.
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function readPreference<T>(
  key: string,
  validate: (value: unknown) => value is T,
  storage?: PreferenceStorage,
): T | undefined {
  try {
    const raw = (storage ?? localStorage).getItem(key);
    if (!raw || raw.length > 100_000) return;
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : undefined;
  } catch {
    return;
  }
}
export function writePreference(key: string, value: unknown, storage?: PreferenceStorage): boolean {
  try {
    const raw = JSON.stringify(value);
    if (raw.length > 100_000) return false;
    (storage ?? localStorage).setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
export function removePreference(key: string, storage?: PreferenceStorage) {
  try {
    (storage ?? localStorage).removeItem(key);
  } catch {
    /* Gameplay remains available without optional storage. */
  }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function isDraftValue(value: unknown, depth = 0): boolean {
  if (depth > 5) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  if (typeof value === 'string') return value.length <= 256;
  if (Array.isArray(value))
    return value.length <= 64 && value.every((item) => isDraftValue(item, depth + 1));
  return (
    isRecord(value) &&
    Object.keys(value).length <= 64 &&
    Object.entries(value).every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && isDraftValue(item, depth + 1),
    )
  );
}
