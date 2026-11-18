import { isScoreSheet } from './games/score-sheets';
import type {
  JsonObject,
  MatchProjectionRecord,
  MatchRecord,
  MatchStatus,
  ScoreEventRecord,
} from './records';
import { createGame } from './games/engine';
import type { EngineState, ScoreCommand } from './engine/types';
import { copyBoundedJson, immutable, parseCommand } from './engine/validation';
import { assertPetanqueMatch, validatePetanqueCommand } from './games/petanque';

export const MAX_JOURNAL_EVENTS = 1_000;
export type JournalAction =
  | {
      readonly type: 'authority_transfer';
      readonly playerId: string;
      readonly deviceId: string;
      readonly transferId: string;
      readonly epoch: number;
    }
  | ScoreCommand
  | { readonly type: 'start' | 'pause' | 'resume' | 'cancel' }
  | {
      readonly type: 'correct';
      readonly targetEventId: string;
      readonly replacement: Extract<ScoreCommand, { type: 'record' }>;
    }
  | { readonly type: 'undo'; readonly targetEventId: string };

export type JournalErrorCode =
  | 'invalid_action'
  | 'invalid_journal'
  | 'invalid_transition'
  | 'invalid_correction'
  | 'history_limit';
export class JournalError extends Error {
  constructor(
    readonly code: JournalErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'JournalError';
  }
}

export function journalId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
export function journalTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new JournalError('invalid_action');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]) {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new JournalError('invalid_action');
}
export function parseJournalAction(input: unknown): JournalAction {
  const action = object(copyBoundedJson(input));
  if (action.type === 'record' || action.type === 'finish') return immutable(parseCommand(action));
  if (['start', 'pause', 'resume', 'cancel'].includes(action.type as string)) {
    keys(action, ['type']);
  } else if (action.type === 'authority_transfer') {
    keys(action, ['type', 'playerId', 'deviceId', 'transferId', 'epoch']);
    if (
      ![action.playerId, action.deviceId, action.transferId].every(journalId) ||
      typeof action.epoch !== 'number' ||
      !Number.isSafeInteger(action.epoch) ||
      action.epoch < 1
    )
      throw new JournalError('invalid_action');
  } else if (action.type === 'undo' || action.type === 'correct') {
    keys(
      action,
      action.type === 'undo' ? ['type', 'targetEventId'] : ['type', 'targetEventId', 'replacement'],
    );
    if (!journalId(action.targetEventId)) throw new JournalError('invalid_action');
    if (action.type === 'correct') {
      const replacement = parseCommand(action.replacement);
      if (replacement.type !== 'record') throw new JournalError('invalid_action');
      action.replacement = replacement;
    }
  } else throw new JournalError('invalid_action');
  return immutable(action as unknown as JournalAction);
}

export interface AuditEntry {
  readonly event: ScoreEventRecord;
  readonly action: JournalAction;
  readonly supersededBy?: string;
}
export interface JournalAuthority {
  readonly playerId: string;
  readonly deviceId?: string;
  readonly epoch: number;
  readonly transferId?: string;
}
export interface JournalView {
  readonly authority: JournalAuthority;
  readonly projection: MatchProjectionRecord;
  readonly state: EngineState;
  readonly audit: readonly AuditEntry[];
}

// Replay uses pinned snapshots, never mutable catalog/profile records or a cached projection.
export function replayJournal(
  match: MatchRecord,
  records: readonly ScoreEventRecord[],
): JournalView {
  if (!Array.isArray(records) || records.length > MAX_JOURNAL_EVENTS)
    throw new JournalError('history_limit');
  if (match.version !== records.length || match.gameVersionId !== match.rulesSnapshot.id)
    throw new JournalError('invalid_journal');
  const game = createGame(match.rulesSnapshot, match.settingsSnapshot.dartsMatch);
  const petanque = match.rulesSnapshot.gameId === 'petanque';
  if (petanque) assertPetanqueMatch(match);
  if (
    game.id !== match.rulesSnapshot.gameId ||
    game.rulesetVersion !== match.rulesSnapshot.rulesetVersion ||
    game.definition.schemaVersion !== match.rulesSnapshot.schemaVersion
  )
    throw new JournalError('invalid_journal');
  const players = match.playersSnapshot.map((player) => player.id);
  const teams = match.teamsSnapshot.map((team) => team.id);
  const config = game.validateConfig(
    match.settingsSnapshot.engineConfig ?? {
      mode: match.mode,
      ownerIds: match.mode === 'teams' ? teams : players,
    },
  );
  const corkWinner = match.settingsSnapshot.dartsCorkWinnerId;
  if (corkWinner !== undefined) {
    const series = match.settingsSnapshot.dartsMatch;
    if (
      match.rulesSnapshot.gameId !== 'darts' ||
      typeof corkWinner !== 'string' ||
      config.ownerIds[0] !== corkWinner ||
      (series &&
        typeof series === 'object' &&
        !Array.isArray(series) &&
        (series as JsonObject).firstStarterId !== corkWinner)
    )
      throw new JournalError('invalid_journal');
  }
  const covered = config.ownerIds.flatMap((id) =>
    teams.includes(id) ? match.teamsSnapshot.find((team) => team.id === id)!.playerIds : [id],
  );
  if (
    config.mode !== match.mode ||
    !players.includes(match.organizerPlayerId) ||
    new Set([...players, ...teams]).size !== players.length + teams.length ||
    covered.length !== players.length ||
    new Set(covered).size !== players.length ||
    covered.some((id) => !players.includes(id)) ||
    (match.mode === 'individual' && config.ownerIds.some((id) => !players.includes(id))) ||
    (match.mode === 'teams' && config.ownerIds.some((id) => !teams.includes(id))) ||
    (match.mode === 'cooperative' && config.ownerIds.length !== 1) ||
    (match.mode === 'mixed' &&
      (!config.ownerIds.some((id) => teams.includes(id)) ||
        !config.ownerIds.some((id) => players.includes(id))))
  )
    throw new JournalError('invalid_journal');
  let authority: JournalAuthority = { playerId: match.organizerPlayerId, epoch: 0 };
  let state = game.initialState(config);
  let status: MatchStatus = 'draft';
  let paused = false;
  const audit: AuditEntry[] = [];
  const ids = new Set<string>();
  const commandIds = new Set<string>();
  const slots: { revision: string; kind: 'record' | 'finish'; command: ScoreCommand | null }[] = [];
  const revisions = new Map<string, number>();

  for (const raw of records) {
    const copy = copyBoundedJson(raw);
    if (!copy || typeof copy !== 'object' || Array.isArray(copy))
      throw new JournalError('invalid_journal');
    const event = copy as ScoreEventRecord;
    if (
      !journalId(event.id) ||
      !journalId(event.commandId) ||
      !journalId(event.deviceId) ||
      event.matchId !== match.id ||
      event.actorPlayerId !== authority.playerId ||
      (authority.deviceId !== undefined && event.deviceId !== authority.deviceId) ||
      event.sequence !== audit.length + 1 ||
      !journalTimestamp(event.timestamp) ||
      ids.has(event.id) ||
      commandIds.has(event.commandId) ||
      event.roundId !== undefined
    )
      throw new JournalError('invalid_journal');
    const payload = object(event.payload);
    keys(
      payload,
      payload.proposal === undefined
        ? ['journalVersion', 'action']
        : ['journalVersion', 'action', 'proposal'],
    );
    if (payload.proposal !== undefined)
      validatePeerAttribution(match, payload.action, payload.proposal, authority.playerId);
    if (payload.journalVersion !== 1) throw new JournalError('invalid_journal');
    const action = parseJournalAction(payload.action);
    const correction = action.type === 'correct' || action.type === 'undo';
    if (event.supersedesId !== (correction ? action.targetEventId : undefined))
      throw new JournalError('invalid_journal');
    if (status === 'cancelled') throw new JournalError('invalid_transition');
    switch (action.type) {
      case 'authority_transfer':
        if (
          !['draft', 'in_progress', 'paused'].includes(status) ||
          action.playerId === authority.playerId ||
          !players.includes(action.playerId) ||
          action.epoch !== authority.epoch + 1 ||
          action.deviceId === event.deviceId
        )
          throw new JournalError('invalid_transition');
        authority = {
          playerId: action.playerId,
          deviceId: action.deviceId,
          epoch: action.epoch,
          transferId: action.transferId,
        };
        break;
      case 'start':
        if (status !== 'draft') throw new JournalError('invalid_transition');
        status = 'in_progress';
        break;
      case 'pause':
        if (status !== 'in_progress') throw new JournalError('invalid_transition');
        paused = true;
        status = 'paused';
        break;
      case 'resume':
        if (status !== 'paused') throw new JournalError('invalid_transition');
        paused = false;
        status = 'in_progress';
        break;
      case 'cancel':
        if (status === 'finished') throw new JournalError('invalid_transition');
        status = 'cancelled';
        break;
      case 'record':
      case 'finish': {
        if (status !== 'in_progress') throw new JournalError('invalid_transition');
        if (petanque) validatePetanqueCommand(match, action);
        for (const scoreEvent of game.decide(state, action, config))
          state = game.evolve(state, scoreEvent, config);
        revisions.set(event.id, slots.length);
        slots.push({ revision: event.id, kind: action.type, command: action });
        status = state.status;
        break;
      }
      case 'correct':
      case 'undo': {
        if (status === 'draft') throw new JournalError('invalid_transition');
        const index = revisions.get(action.targetEventId);
        const slot = index === undefined ? undefined : slots[index];
        if (
          !slot ||
          slot.revision !== action.targetEventId ||
          (action.type === 'undo' && !slot.command) ||
          (action.type === 'correct' && slot.kind !== 'record')
        )
          throw new JournalError('invalid_correction');
        const previous = audit.findIndex((entry) => entry.event.id === slot.revision);
        audit[previous] = { ...audit[previous]!, supersededBy: event.id };
        slot.command = action.type === 'correct' ? action.replacement : null;
        slot.revision = event.id;
        revisions.set(event.id, index!);
        state = game.initialState(config);
        try {
          for (const active of slots) {
            if (!active.command) continue;
            if (petanque) validatePetanqueCommand(match, active.command);
            for (const scoreEvent of game.decide(state, active.command, config))
              state = game.evolve(state, scoreEvent, config);
          }
        } catch (cause) {
          // A correction never silently drops later entries to make a history valid.
          throw new JournalError('invalid_correction', { cause });
        }
        status = state.status === 'finished' ? 'finished' : paused ? 'paused' : 'in_progress';
        break;
      }
    }
    ids.add(event.id);
    commandIds.add(event.commandId);
    audit.push({ event, action });
  }
  return immutable({
    authority,
    state,
    audit,
    projection: {
      matchId: match.id,
      lastEventSequence: records.length,
      status,
      totals: state.totals,
      winnerIds: status === 'finished' ? state.winnerIds : [],
      ...(status === 'finished' && state.winnerIds.length === 1
        ? { winnerId: state.winnerIds[0] }
        : {}),
    },
  });
}

export interface PeerAttribution {
  readonly playerId: string;
  readonly sessionId: string;
  readonly permissionRevision: number;
  readonly role: 'scorer' | 'manager';
}
// Historical attribution records the organizer's approval, not independent peer authority.
export function validatePeerAttribution(
  match: MatchRecord,
  actionInput: unknown,
  input: unknown,
  organizerPlayerId = match.organizerPlayerId,
): PeerAttribution {
  const proposal = object(copyBoundedJson(input));
  keys(proposal, ['playerId', 'sessionId', 'permissionRevision', 'role']);
  if (
    !journalId(proposal.playerId) ||
    !match.playersSnapshot.some((p) => p.id === proposal.playerId) ||
    proposal.playerId === organizerPlayerId ||
    !journalId(proposal.sessionId) ||
    typeof proposal.permissionRevision !== 'number' ||
    !Number.isSafeInteger(proposal.permissionRevision) ||
    proposal.permissionRevision < 1 ||
    (proposal.role !== 'scorer' && proposal.role !== 'manager')
  )
    throw new JournalError('invalid_action');
  const action = parseJournalAction(actionInput);
  if (action.type === 'authority_transfer') throw new JournalError('invalid_action');
  if (proposal.role === 'scorer') {
    // A self scorer cannot adjudicate shared rounds, transition legs or manage other camps.
    const ownCamp =
      action.type === 'record' &&
      (action.ownerId === proposal.playerId ||
        match.teamsSnapshot.some(
          (team) =>
            team.id === action.ownerId && team.playerIds.includes(proposal.playerId as string),
        ));
    if (!ownCamp || action.type !== 'record' || isScoreSheet(match.rulesSnapshot.gameId))
      throw new JournalError('invalid_action');
    if (!match.rulesSnapshot.gameId.startsWith('custom-')) {
      if (
        ['nextRound', 'nextLeg', 'best', 'worst'].some((key) =>
          Object.hasOwn(action.values, key),
        ) ||
        (match.rulesSnapshot.gameId === 'petanque' && action.values.kind !== 0)
      )
        throw new JournalError('invalid_action');
    }
  }
  return proposal as unknown as PeerAttribution;
}
