import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { BoardConnector } from '#lib/application/granboard/connection';
let granBoard: (typeof import('../../src/lib/application/granboard/session.svelte'))['granBoard'];

beforeAll(async () => {
  // Vitest runs this module without Svelte's rune transformation.
  vi.stubGlobal('$state', (value?: unknown) => value);
  try {
    ({ granBoard } = await import('../../src/lib/application/granboard/session.svelte'));
  } finally {
    vi.unstubAllGlobals();
  }
});

function transport() {
  const attempts: { signal: AbortSignal; receiver: Parameters<BoardConnector>[1] }[] = [];
  const connect: BoardConnector = async (signal, receiver) => {
    attempts.push({ signal, receiver });
  };
  return { connect, attempts };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  granBoard.stop();
  vi.useRealTimers();
});

test('does not retry a pairing that never becomes ready or accept a late ready event', async () => {
  const { connect, attempts } = transport();
  granBoard.start('match', connect, 20);
  expect(granBoard.status).toBe('connecting');
  await vi.advanceTimersByTimeAsync(20);
  expect(attempts[0]!.signal.aborted).toBe(true);
  expect(granBoard.status).toBe('failed');
  attempts[0]!.receiver.ready();
  await vi.advanceTimersByTimeAsync(3000);
  expect(attempts).toHaveLength(1);
  expect(granBoard.status).toBe('failed');
});

test('retries a lost session, rejects its stale hits and stops pending attempts on release', async () => {
  const { connect, attempts } = transport();
  const hit = vi.fn();
  const detach = granBoard.listen('match', hit);
  granBoard.start('match', connect, 20);
  const first = attempts[0]!;
  first.receiver.ready();
  first.receiver.frame('3.4@');
  expect(hit).toHaveBeenCalledExactlyOnceWith({ sector: 20, multiplier: 3 });
  first.receiver.lost();
  first.receiver.frame('3.4@');
  expect(hit).toHaveBeenCalledTimes(1);
  expect(granBoard.status).toBe('reconnecting');

  await vi.advanceTimersByTimeAsync(3000);
  const second = attempts[1]!;
  second.receiver.ready();
  detach();
  second.receiver.frame('3.4@');
  expect(hit).toHaveBeenCalledTimes(1);
  second.receiver.lost();
  granBoard.stop('different-match');
  expect(granBoard.matchId).toBe('match');
  granBoard.stop('match');
  await vi.advanceTimersByTimeAsync(3000);
  expect(granBoard.status).toBeUndefined();
  expect(attempts).toHaveLength(2);
});
