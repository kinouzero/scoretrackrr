import type { BoardConnector } from './connection';
import { decodeHit, type BoardHit } from './protocol';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'failed';

class GranBoardSession {
  matchId = $state<string>();
  status = $state<Status>();
  private connection?: AbortController;
  private receiver?: { matchId: string; hit: (hit: BoardHit) => void };

  listen(matchId: string, hit: (hit: BoardHit) => void) {
    const receiver = { matchId, hit };
    this.receiver = receiver;
    return () => {
      if (this.receiver === receiver) this.receiver = undefined;
    };
  }

  stop(matchId = this.matchId) {
    if (this.matchId !== matchId) return;
    this.connection?.abort();
    this.connection = undefined;
    this.matchId = undefined;
    this.status = undefined;
  }

  start(matchId: string, connect: BoardConnector, initialTimeout: number) {
    this.stop();
    const connection = new AbortController();
    this.connection = connection;
    this.matchId = matchId;
    this.status = 'connecting';
    let hasConnected = false;
    const connectAttempt = () => {
      const attempt = new AbortController();
      const signal = AbortSignal.any([connection.signal, attempt.signal]);
      let retry: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timeout);
        clearTimeout(retry);
        attempt.abort();
      };
      const lost = () => {
        if (signal.aborted) return;
        clearTimeout(timeout);
        attempt.abort();
        if (!hasConnected) {
          this.status = 'failed';
          return;
        }
        this.status = 'reconnecting';
        retry = setTimeout(() => {
          connection.signal.removeEventListener('abort', cleanup);
          connectAttempt();
        }, 3000);
      };
      const timeout = setTimeout(lost, hasConnected ? 20000 : initialTimeout);
      connection.signal.addEventListener('abort', cleanup, { once: true });
      void connect(signal, {
        frame: (frame) => {
          const receiver = this.receiver;
          if (signal.aborted || this.status !== 'connected' || receiver?.matchId !== matchId)
            return;
          const hit = decodeHit(frame);
          if (hit) receiver.hit(hit);
        },
        ready: () => {
          if (signal.aborted) return;
          clearTimeout(timeout);
          hasConnected = true;
          this.status = 'connected';
        },
        lost,
      }).catch(lost);
    };
    connectAttempt();
  }
}

export const granBoard = new GranBoardSession();
