const numeric = { type: 'number', minimum: -1_000_000_000, maximum: 1_000_000_000 };
const total = { type: 'number', minimum: -1_000_000_000_000, maximum: 1_000_000_000_000 };
const fieldId = { type: 'string', pattern: '^[a-z][a-zA-Z0-9_]{0,31}$' };
const ownerId = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$' };
const modes = { type: 'string', enum: ['individual', 'teams', 'cooperative', 'mixed'] };
const values = {
  type: 'object',
  minProperties: 1,
  maxProperties: 24,
  propertyNames: fieldId,
  additionalProperties: numeric,
};
const expression = { $ref: '#/$defs/expression' };
const rulesetVersion = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,31}$' };

export const rulesSchema = {
  $id: 'urn:scoretrackrr:rules:v1',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'id',
    'rulesetVersion',
    'supportedModes',
    'fields',
    'score',
    'initialScore',
    'objective',
    'ties',
  ],
  properties: {
    schemaVersion: { const: 1 },
    id: ownerId,
    rulesetVersion,
    supportedModes: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: modes },
    fields: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'minimum', 'maximum', 'integer'],
        properties: {
          id: fieldId,
          minimum: numeric,
          maximum: numeric,
          integer: { type: 'boolean' },
        },
      },
    },
    score: expression,
    initialScore: numeric,
    objective: {
      type: 'object',
      additionalProperties: false,
      required: ['direction'],
      properties: { direction: { enum: ['highest', 'lowest'] }, target: numeric },
    },
    ties: { enum: ['shared', 'continue'] },
    turns: {
      type: 'object',
      additionalProperties: false,
      required: ['rounds'],
      properties: {
        rounds: { type: 'integer', minimum: 1, maximum: 50 },
        categories: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: { type: 'string', pattern: '^[^\\u0000-\\u001f\\u007f]{1,60}$' },
        },
      },
    },
  },
  $defs: {
    expression: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'value'],
          properties: { op: { const: 'constant' }, value: numeric },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'field'],
          properties: { op: { const: 'input' }, field: fieldId },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'left', 'right'],
          properties: {
            op: { enum: ['add', 'subtract', 'multiply', 'divide', 'min', 'max'] },
            left: expression,
            right: expression,
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['op', 'condition', 'then', 'else'],
          properties: {
            op: { const: 'if' },
            condition: { $ref: '#/$defs/condition' },
            then: expression,
            else: expression,
          },
        },
      ],
    },
    condition: {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'left', 'right'],
      properties: {
        op: { enum: ['eq', 'gt', 'gte', 'lt', 'lte'] },
        left: expression,
        right: expression,
      },
    },
  },
};

export const configSchema = {
  $id: 'urn:scoretrackrr:config:v1',
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'ownerIds'],
  properties: {
    mode: modes,
    ownerIds: { type: 'array', minItems: 1, maxItems: 64, uniqueItems: true, items: ownerId },
  },
};

export const commandSchema = {
  $id: 'urn:scoretrackrr:command:v1',
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'ownerId', 'values'],
      properties: { type: { const: 'record' }, ownerId, values },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type'],
      properties: { type: { const: 'finish' } },
    },
  ],
};

export const eventSchema = {
  $id: 'urn:scoretrackrr:event:v1',
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'ownerId', 'values', 'delta', 'gameId', 'rulesetVersion'],
      properties: {
        type: { const: 'score_recorded' },
        ownerId,
        values,
        delta: total,
        gameId: ownerId,
        rulesetVersion,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'gameId', 'rulesetVersion'],
      properties: { type: { const: 'game_finished' }, gameId: ownerId, rulesetVersion },
    },
  ],
};

export const stateSchema = {
  $id: 'urn:scoretrackrr:state:v1',
  type: 'object',
  additionalProperties: false,
  required: ['totals', 'eventCount', 'status', 'winnerIds'],
  properties: {
    totals: {
      type: 'object',
      minProperties: 1,
      maxProperties: 64,
      propertyNames: ownerId,
      additionalProperties: total,
    },
    eventCount: { type: 'integer', minimum: 0, maximum: 10_000 },
    status: { enum: ['in_progress', 'finished'] },
    winnerIds: { type: 'array', maxItems: 64, uniqueItems: true, items: ownerId },
  },
};
