import { EngineError, type Expression } from '../engine/types';
import { parseRules } from '../engine/validation';
import type { DeclarativeRules } from '../engine/types';
import type { CounterSettings } from './counter';
export interface BuilderField {
  id: string;
  minimum: number;
  maximum: number;
  weight: number;
}
export interface BuilderSettings extends CounterSettings {
  fields: BuilderField[];
  turns?: DeclarativeRules['turns'];
  bonus?: { field: string; threshold: number; points: number };
}
export function builderDefinition(id: string, rulesetVersion: string, input: BuilderSettings) {
  if (
    !Array.isArray(input.fields) ||
    input.fields.length < 1 ||
    input.fields.length > 8 ||
    input.fields.some((field) => !Number.isFinite(field.weight) || Math.abs(field.weight) > 1000)
  )
    throw new EngineError('invalid_rules');
  const terms: Expression[] = input.fields.map((field) => ({
    op: 'multiply',
    left: { op: 'input', field: field.id },
    right: { op: 'constant', value: field.weight },
  }));
  let score = terms.reduce((left, right) => ({ op: 'add', left, right }));
  if (input.bonus) {
    if (!input.fields.some((field) => field.id === input.bonus!.field))
      throw new EngineError('invalid_rules');
    score = {
      op: 'add',
      left: score,
      right: {
        op: 'if',
        condition: {
          op: 'gte',
          left: { op: 'input', field: input.bonus.field },
          right: { op: 'constant', value: input.bonus.threshold },
        },
        then: { op: 'constant', value: input.bonus.points },
        else: { op: 'constant', value: 0 },
      },
    };
  }
  return parseRules({
    schemaVersion: 1,
    id,
    rulesetVersion,
    supportedModes: ['individual', 'teams', 'cooperative', 'mixed'],
    fields: input.fields.map((field) => ({
      id: field.id,
      minimum: field.minimum,
      maximum: field.maximum,
      integer: true,
    })),
    score,
    initialScore: input.initialScore,
    objective: {
      direction: input.direction,
      ...(input.target === undefined ? {} : { target: input.target }),
    },
    ties: 'shared',
    ...(input.turns ? { turns: input.turns } : {}),
  });
}
export function readBuilder(rules: DeclarativeRules): BuilderSettings {
  const weights = new Map<string, number>();
  let bonus: BuilderSettings['bonus'];
  let score = rules.score;
  if (score.op === 'add' && score.right.op === 'if') {
    const expr = score.right;
    if (
      expr.condition.op !== 'gte' ||
      expr.condition.left.op !== 'input' ||
      expr.condition.right.op !== 'constant' ||
      expr.then.op !== 'constant' ||
      expr.else.op !== 'constant' ||
      expr.else.value !== 0
    )
      throw new EngineError('invalid_rules');
    bonus = {
      field: expr.condition.left.field,
      threshold: expr.condition.right.value,
      points: expr.then.value,
    };
    score = score.left;
  }
  function read(expr: Expression): void {
    if (expr.op === 'add') {
      read(expr.left);
      read(expr.right);
      return;
    }
    const field =
      expr.op === 'input'
        ? expr.field
        : expr.op === 'multiply' && expr.left.op === 'input' && expr.right.op === 'constant'
          ? expr.left.field
          : undefined;
    if (!field || weights.has(field)) throw new EngineError('invalid_rules');
    weights.set(
      field,
      expr.op === 'multiply' && expr.right.op === 'constant' ? expr.right.value : 1,
    );
  }
  read(score);
  if (weights.size !== rules.fields.length) throw new EngineError('invalid_rules');
  const fields = rules.fields.map((field) => {
    if (!weights.has(field.id) || !field.integer) throw new EngineError('invalid_rules');
    return {
      id: field.id,
      minimum: field.minimum,
      maximum: field.maximum,
      weight: weights.get(field.id)!,
    };
  });
  return {
    minimum: fields[0]!.minimum,
    maximum: fields[0]!.maximum,
    initialScore: rules.initialScore,
    direction: rules.objective.direction,
    ...(rules.objective.target === undefined ? {} : { target: rules.objective.target }),
    fields,
    ...(rules.turns ? { turns: rules.turns } : {}),
    ...(bonus ? { bonus } : {}),
  };
}
