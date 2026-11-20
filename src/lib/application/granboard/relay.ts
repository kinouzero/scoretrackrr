import type { BoardReceiver } from './connection';

const relayPath = '/api/granboard/';

export async function relayAvailable(signal: AbortSignal) {
  const response = await fetch(relayPath + 'status', { signal, cache: 'no-store' });
  return response.ok && (await response.json()).protocol === 'granboard-v1';
}

export async function connectRelay(code: string, signal: AbortSignal, receiver: BoardReceiver) {
  const response = await fetch(relayPath + 'session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    signal,
  });
  if (!response.ok) throw new Error('Relay pairing failed');
  signal.throwIfAborted();
  const stream = new EventSource(relayPath + 'events');
  signal.addEventListener('abort', () => stream.close(), { once: true });
  let sequence = 0;
  let ready = false;
  let pendingLight = Promise.resolve();
  stream.onerror = receiver.lost;
  stream.addEventListener('board', (event: MessageEvent<string>) => {
    try {
      const value = JSON.parse(event.data);
      if (value.type === 'ready' && !ready) {
        ready = true;
        receiver.ready(
          value.lights === true
            ? (frame) => {
                const write = pendingLight.then(async () => {
                  signal.throwIfAborted();
                  const response = await fetch(relayPath + 'lights', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: frame,
                    signal,
                  });
                  if (!response.ok) throw new Error('Relay light command failed');
                });
                pendingLight = write.catch(() => {});
                return write;
              }
            : undefined,
        );
      } else if (ready && value.type === 'hit' && typeof value.frame === 'string') {
        if (value.sequence === sequence) return;
        if (value.sequence !== sequence + 1) throw new Error('Missing relay event');
        sequence = value.sequence;
        receiver.frame(value.frame);
      } else {
        throw new Error('Unexpected relay event');
      }
    } catch {
      receiver.lost();
    }
  });
}
