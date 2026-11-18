import type { Condition, Expression } from './types';
import { EngineError } from './types';

export function boundedNumber(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000)
    throw new EngineError('arithmetic');
  return value === 0 ? 0 : value;
}

// Expressions must first pass parseRules. Only these fixed operations execute.
export function evaluate(expression: Expression, inputs: Readonly<Record<string, number>>): number {
  if (expression.op === 'constant') return expression.value;
  if (expression.op === 'input') {
    if (!Object.hasOwn(inputs, expression.field)) throw new EngineError('invalid_command');
    return boundedNumber(inputs[expression.field]!);
  }
  if (expression.op === 'if')
    return evaluate(
      compare(expression.condition, inputs) ? expression.then : expression.else,
      inputs,
    );
  const left = evaluate(expression.left, inputs),
    right = evaluate(expression.right, inputs);
  switch (expression.op) {
    case 'add':
      return boundedNumber(left + right);
    case 'subtract':
      return boundedNumber(left - right);
    case 'multiply':
      return boundedNumber(left * right);
    case 'divide':
      if (right === 0) throw new EngineError('arithmetic');
      return boundedNumber(left / right);
    case 'min':
      return Math.min(left, right);
    case 'max':
      return Math.max(left, right);
    default:
      throw new EngineError('invalid_rules');
  }
}

function compare(condition: Condition, inputs: Readonly<Record<string, number>>): boolean {
  const left = evaluate(condition.left, inputs),
    right = evaluate(condition.right, inputs);
  switch (condition.op) {
    case 'eq':
      return left === right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
    default:
      throw new EngineError('invalid_rules');
  }
}
