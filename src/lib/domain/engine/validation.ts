import type {
  Condition,
  DeclarativeRules,
  EngineConfig,
  EngineState,
  Expression,
  ScoreCommand,
  ScoreEvent,
} from './types';
import { EngineError } from './types';
import {
  validateRules,
  validateConfig,
  validateState,
  validateCommand,
  validateEvent,
} from './validators.generated.js';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function safeKey(key: string): boolean {
  return !forbiddenKeys.has(key);
}

// Bound traversal before recursive schema validation. Copy only plain JSON data,
// so getters, non-finite numbers, cycles and prototype keys never reach the engine.
export function copyBoundedJson(input: unknown): unknown {
  const seen = new Set<object>();
  let nodes = 0;
  let characters = 0;
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 1024 || depth > 20) throw new EngineError('input_limit');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new EngineError('input_limit');
      return value === 0 ? 0 : value;
    }
    if (typeof value === 'string') {
      characters += value.length;
      if (value.length > 2048 || characters > 65_536) throw new EngineError('input_limit');
      return value;
    }
    if (typeof value !== 'object' || seen.has(value)) throw new EngineError('input_limit');
    seen.add(value);
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new EngineError('input_limit');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) throw new EngineError('input_limit');
    if (array) {
      if (value.length > 128 || Object.keys(descriptors).length !== value.length + 1)
        throw new EngineError('input_limit');
      const result = Array.from({ length: value.length }, (_, index) => {
        const descriptor = descriptors[index];
        if (!descriptor || !('value' in descriptor)) throw new EngineError('input_limit');
        return visit(descriptor.value, depth + 1);
      });
      seen.delete(value);
      return result;
    }
    const result: Record<string, unknown> = {};
    if (Object.keys(descriptors).length > 128) throw new EngineError('input_limit');
    for (const [key, descriptor] of Object.entries(descriptors)) {
      characters += key.length;
      if (
        !safeKey(key) ||
        key.length > 128 ||
        characters > 65_536 ||
        !('value' in descriptor) ||
        !descriptor.enumerable
      )
        throw new EngineError('input_limit');
      result[key] = visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
    return result;
  }
  return visit(input, 0);
}

export function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function parse<T>(
  input: unknown,
  validate: (value: unknown) => boolean,
  code: 'invalid_rules' | 'invalid_config' | 'invalid_state' | 'invalid_command' | 'invalid_event',
): T {
  const value = copyBoundedJson(input);
  if (!validate(value)) throw new EngineError(code);
  return value as T;
}

export function parseRules(input: unknown): DeclarativeRules {
  const rules = parse<DeclarativeRules>(input, validateRules, 'invalid_rules');
  const fields = new Set(rules.fields.map((field) => field.id));
  if (
    fields.size !== rules.fields.length ||
    rules.fields.some((field) => !safeKey(field.id) || field.minimum > field.maximum)
  )
    throw new EngineError('invalid_rules');
  if (
    rules.turns &&
    (rules.ties !== 'shared' ||
      (rules.turns.categories &&
        (rules.turns.categories.length !== rules.turns.rounds ||
          rules.turns.categories.some((name) => name !== name.trim()))))
  )
    throw new EngineError('invalid_rules');
  const target = rules.objective.target;
  if (
    target !== undefined &&
    (rules.objective.direction === 'highest'
      ? rules.initialScore >= target
      : rules.initialScore <= target)
  )
    throw new EngineError('invalid_rules');
  const stack: { node: Expression | Condition; depth: number }[] = [
    { node: rules.score, depth: 1 },
  ];
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (++count > 128 || depth > 12) throw new EngineError('input_limit');
    if (node.op === 'input' && !fields.has(node.field)) throw new EngineError('invalid_rules');
    if (node.op === 'if')
      for (const child of [node.condition, node.then, node.else])
        stack.push({ node: child, depth: depth + 1 });
    else if ('left' in node)
      for (const child of [node.left, node.right]) stack.push({ node: child, depth: depth + 1 });
  }
  return immutable(rules);
}

export const parseConfig = (input: unknown) =>
  parse<EngineConfig>(input, validateConfig, 'invalid_config');
export const parseState = (input: unknown) =>
  parse<EngineState>(input, validateState, 'invalid_state');
export const parseCommand = (input: unknown) =>
  parse<ScoreCommand>(input, validateCommand, 'invalid_command');
export const parseEvent = (input: unknown) =>
  parse<ScoreEvent>(input, validateEvent, 'invalid_event');
