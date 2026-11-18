import { untrack } from 'svelte';
import {
  isDraftValue,
  isRecord,
  readPreference,
  removePreference,
  writePreference,
} from './local-preferences';

function sameShape(template: unknown, value: unknown): boolean {
  if (template === undefined || template === null)
    return value === null || value === undefined || isDraftValue(value);
  if (Array.isArray(template))
    return (
      Array.isArray(value) &&
      template.length === value.length &&
      value.every((item, index) => sameShape(template[index], item))
    );
  if (isRecord(template))
    return (
      isRecord(value) &&
      Object.keys(template).every((key) => sameShape(template[key], value[key])) &&
      (Object.keys(template).length > 0 ||
        Object.values(value).every(
          (item) => typeof item === 'number' || item === '' || item === null,
        ))
    );
  return typeof template === typeof value;
}
interface DraftRecord {
  context: string;
  value: Record<string, unknown>;
}
export function parseDraft(value: unknown): value is DraftRecord {
  return (
    isRecord(value) &&
    typeof value.context === 'string' &&
    value.context.length < 512 &&
    isRecord(value.value) &&
    isDraftValue(value.value)
  );
}
// The journal sequence is part of the context: old input can never cross a turn or correction.
export function entryDraft<T extends Record<string, unknown>>(
  identity: () => string,
  context: () => string,
  capture: () => T,
  restore: (value: T) => void | boolean,
) {
  let loaded = '';
  let baseline = '';
  let recovered = $state(false);
  $effect(() => {
    const key = `scoretrackrr.entry.${identity()}`;
    const scope = context();
    const token = `${key}:${scope}`;
    if (loaded === token) return;
    loaded = token;
    recovered = false;
    const saved = readPreference(key, parseDraft);
    const initial = untrack(capture);
    baseline = JSON.stringify(initial);
    if (saved?.context === scope && sameShape(initial, saved.value)) {
      const applied = untrack(() => restore(saved.value as T));
      recovered = applied !== false && JSON.stringify(saved.value) !== JSON.stringify(initial);
    } else if (saved) removePreference(key);
  });
  $effect(() => {
    const key = `scoretrackrr.entry.${identity()}`;
    const scope = context();
    const value = JSON.parse(JSON.stringify(capture())) as T;
    if (loaded === `${key}:${scope}` && isDraftValue(value)) {
      if (JSON.stringify(value) === baseline) removePreference(key);
      else writePreference(key, { context: scope, value });
    }
  });
  return {
    get recovered() {
      return recovered;
    },
  };
}
