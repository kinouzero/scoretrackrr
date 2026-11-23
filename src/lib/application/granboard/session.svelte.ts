import type { BoardConnector, LightWriter } from './connection';
import { decodeHit, type BoardHit } from './protocol';

import { unlockDartsAudio } from '../darts-audio';
import { impactLights, readyLight, type LightOutcome, type LightPattern } from './feedback';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'failed';

class GranBoardSession {
  matchId = $state<string>();
  status = $state<Status>();
  private connection?: AbortController;
  private receiver?: { matchId: string; hit: (hit: BoardHit) => void; next: () => void };
  private light?: LightWriter;
  private lightTimer?: ReturnType<typeof setTimeout>;
  private finishTimer?: ReturnType<typeof setTimeout>;
  private nextButtonAt = -Infinity;

  captureLight() {
    const light = this.light;
    return (hit: BoardHit, outcome: LightOutcome, guide?: LightPattern) => {
      if (!light || this.light !== light) return;
      this.playLights(light, impactLights(hit, outcome), guide);
    };
  }

  signalReady(guide?: LightPattern) {
    if (this.light) this.playLights(this.light, [readyLight()], guide);
  }

  private playLights(light: LightWriter, frames: readonly LightPattern[], guide?: LightPattern) {
    clearTimeout(this.lightTimer);
    const send = (index: number) => {
      if (this.light !== light) return;
      void light(frames[index]!).catch(() => {});
      if (index + 1 < frames.length) {
        this.lightTimer = setTimeout(() => send(index + 1), 145);
      } else if (guide) {
        this.lightTimer = setTimeout(() => {
          if (this.light === light) void light(guide).catch(() => {});
        }, 600);
      }
    };
    send(0);
  }

  listen(matchId: string, hit: (hit: BoardHit) => void, next = () => {}) {
    const receiver = { matchId, hit, next };
    this.receiver = receiver;
    return () => {
      if (this.receiver === receiver) this.receiver = undefined;
    };
  }

  finish(matchId: string) {
    if (this.matchId !== matchId || this.finishTimer !== undefined) return;
    // Give the last accepted hit time to reach the board before disconnecting.
    this.finishTimer = setTimeout(() => this.stop(matchId), 1250);
  }

  stop(matchId = this.matchId) {
    if (this.matchId !== matchId) return;
    clearTimeout(this.finishTimer);
    this.finishTimer = undefined;
    this.connection?.abort();
    this.connection = undefined;
    clearTimeout(this.lightTimer);
    this.light = undefined;
    this.nextButtonAt = -Infinity;
    this.matchId = undefined;
    this.status = undefined;
  }

  start(matchId: string, connect: BoardConnector, initialTimeout: number) {
    this.stop();
    unlockDartsAudio();
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
        clearTimeout(this.lightTimer);
        this.light = undefined;
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
          if (frame === 'BTN@') {
            const now = performance.now();
            if (now - this.nextButtonAt >= 450) {
              this.nextButtonAt = now;
              receiver.next();
            }
            return;
          }
          const hit = decodeHit(frame);
          if (hit) receiver.hit(hit);
        },
        ready: (light) => {
          if (signal.aborted) return;
          clearTimeout(timeout);
          hasConnected = true;
          this.light = light;
          this.status = 'connected';
        },
        lost,
      }).catch(lost);
    };
    connectAttempt();
  }
}

export const granBoard = new GranBoardSession();
