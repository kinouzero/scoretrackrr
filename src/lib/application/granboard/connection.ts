export type LightWriter = (frame: Uint8Array<ArrayBuffer>) => Promise<void>;
export type BoardReceiver = {
  frame: (frame: string) => void;
  ready: (light?: LightWriter) => void;
  lost: () => void;
};

export type BoardConnector = (signal: AbortSignal, receiver: BoardReceiver) => Promise<void>;
