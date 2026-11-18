import {
  skullCaptureCaps,
  type SkullEntry,
  type SkullCapture as Capture,
} from '#lib/domain/games/skull-king';
export type SkullCapture = Capture;
export type SkullResultDraft = Record<keyof typeof skullCaptureCaps | 'won', number> &
  Partial<Record<SkullCapture, number>>;
export function skullCounterLimits(
  entries: Readonly<Record<string, SkullEntry>>,
  drafts: Readonly<Record<string, SkullResultDraft>>,
  ownerId: string,
  cards: number,
  caps: Partial<Record<SkullCapture, number>> = skullCaptureCaps,
): SkullResultDraft {
  const value = (id: string, field: SkullCapture | 'won') => {
    const row = entries[id]!;
    const count = row.won !== null ? row[field] : (drafts[id]?.[field] ?? 0);
    return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0;
  };
  const others = Object.keys(entries).filter((id) => id !== ownerId);
  const used = (field: SkullCapture | 'won') =>
    others.reduce((sum, id) => sum + value(id, field), 0);
  const result: SkullResultDraft = {
    won: Math.max(0, cards - used('won')),
    c14: 0,
    b14: 0,
    mermaids: 0,
    pirates: 0,
    king: 0,
  };
  for (const field of Object.keys(caps) as SkullCapture[])
    result[field] = Math.max(0, caps[field]! - used(field));
  if (caps.loot) result.loot = Math.min(2, result.loot ?? 0);
  if (used('king') + value(ownerId, 'king') > 0) result.pirates = 0;
  if (used('pirates') + value(ownerId, 'pirates') > 0) result.king = 0;
  return result;
}
