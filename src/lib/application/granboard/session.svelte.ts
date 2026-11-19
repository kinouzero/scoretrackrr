import type { BoardConnector, LightWriter } from './connection';
import { decodeHit, type BoardHit } from './protocol';

import { impactLight, playImpact, readyLight, type ImpactOutcome } from './feedback';

type Status = 'connecting' | 'connected' | 'reconnecting' | 'failed';

class GranBoardSession {
  matchId = $state<string>();
  status = $state<Status>();
  private connection?: AbortController;
  private receiver?: { matchId: string; hit: (hit: BoardHit) => void; next: () => void };
  private audio?: AudioContext;
  private light?: LightWriter;
  private lightReset?: ReturnType<typeof setTimeout>;
  private nextButtonAt = -Infinity;
  sound = $state(true);

  enableAudio() {
    if (!this.sound) return;
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume().catch(() => {});
    } catch {
      // Scoring remains available on devices without Web Audio.
    }
  }

  captureFeedback() {
    const audio = this.audio;
    const light = this.light;
    return (hit: BoardHit, outcome: ImpactOutcome) => {
      if (this.sound && audio) playImpact(audio, hit, outcome);
      if (!light || this.light !== light) return;
      clearTimeout(this.lightReset);
      void light(impactLight(hit, outcome === 'bust')).catch(() => {});
      this.lightReset = setTimeout(() => this.signalReady(), 600);
    };
  }

  signalReady() {
    clearTimeout(this.lightReset);
    void this.light?.(readyLight()).catch(() => {});
  }

  listen(matchId: string, hit: (hit: BoardHit) => void, next = () => {}) {
    const receiver = { matchId, hit, next };
    this.receiver = receiver;
    return () => {
      if (this.receiver === receiver) this.receiver = undefined;
    };
  }

  stop(matchId = this.matchId) {
    if (this.matchId !== matchId) return;
    this.connection?.abort();
    this.connection = undefined;
    clearTimeout(this.lightReset);
    this.light = undefined;
    const audio = this.audio;
    this.audio = undefined;
    // Let the last dart's victory cue finish when the match releases the board.
    if (audio) setTimeout(() => void audio.close().catch(() => {}), 800);
    this.nextButtonAt = -Infinity;
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
        clearTimeout(this.lightReset);
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
          this.signalReady();
        },
        lost,
      }).catch(lost);
    };
    connectAttempt();
  }
}

export const granBoard = new GranBoardSession();
