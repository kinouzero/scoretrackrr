import type { MatchMode } from '../records';

export type Expression =
  | { readonly op: 'constant'; readonly value: number }
  | { readonly op: 'input'; readonly field: string }
  | {
      readonly op: 'add' | 'subtract' | 'multiply' | 'divide' | 'min' | 'max';
      readonly left: Expression;
      readonly right: Expression;
    }
  | {
      readonly op: 'if';
      readonly condition: Condition;
      readonly then: Expression;
      readonly else: Expression;
    };

export interface Condition {
  readonly op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  readonly left: Expression;
  readonly right: Expression;
}

export interface InputField {
  readonly id: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly integer: boolean;
}

export interface DeclarativeRules {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly rulesetVersion: string;
  readonly supportedModes: readonly MatchMode[];
  readonly fields: readonly InputField[];
  readonly score: Expression;
  readonly initialScore: number;
  readonly objective: { readonly direction: 'highest' | 'lowest'; readonly target?: number };
  readonly ties: 'shared' | 'continue';
  readonly turns?: { readonly rounds: number; readonly categories?: readonly string[] };
}

export interface EngineConfig {
  readonly mode: MatchMode;
  readonly ownerIds: readonly string[];
}
export interface EngineState {
  readonly totals: Readonly<Record<string, number>>;
  readonly eventCount: number;
  readonly status: 'in_progress' | 'finished';
  readonly winnerIds: readonly string[];
}
export type ScoreCommand =
  | {
      readonly type: 'record';
      readonly ownerId: string;
      readonly values: Readonly<Record<string, number>>;
    }
  | { readonly type: 'finish' };
export type ScoreEvent = { readonly gameId: string; readonly rulesetVersion: string } & (
  | {
      readonly type: 'score_recorded';
      readonly ownerId: string;
      readonly values: Readonly<Record<string, number>>;
      readonly delta: number;
    }
  | { readonly type: 'game_finished' }
);
export interface EngineView extends EngineState {
  readonly ranking: readonly {
    readonly ownerId: string;
    readonly total: number;
    readonly rank: number;
  }[];
}

// Trusted specialist modules can implement this contract without exposing code in JSON.
export interface GameDefinition<Config, State, Command, Event, View> {
  readonly id: string;
  readonly rulesetVersion: string;
  readonly supportedModes: readonly MatchMode[];
  validateConfig(input: unknown): Config;
  initialState(config: Config): State;
  validateAction(state: State, input: unknown, config: Config): Command;
  decide(state: State, command: Command, config: Config): readonly Event[];
  evolve(state: State, event: Event, config: Config): State;
  getView(state: State, config: Config): View;
  isFinished(state: State, config: Config): boolean;
}

export type EngineErrorCode =
  | 'invalid_rules'
  | 'invalid_config'
  | 'invalid_state'
  | 'invalid_command'
  | 'invalid_event'
  | 'input_limit'
  | 'arithmetic'
  | 'finished'
  | 'tie'
  | 'target_not_reached'
  | 'empty_game';
export class EngineError extends Error {
  constructor(readonly code: EngineErrorCode) {
    super(code);
    this.name = 'EngineError';
  }
}
