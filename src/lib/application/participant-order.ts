export function moveParticipant<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = [...items];
  const target = index + direction;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
export function shuffleParticipants<T>(items: readonly T[], random = Math.random): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const sample = random();
    if (sample < 0 || sample >= 1 || !Number.isFinite(sample))
      throw new RangeError('Invalid random sample');
    const target = Math.floor(sample * (index + 1));
    [next[index], next[target]] = [next[target]!, next[index]!];
  }
  return next;
}
