import type { MatchRecord, ScoreEventRecord } from './records';
import { immutable, copyBoundedJson, safeKey } from './engine/validation';
import { journalId, journalTimestamp, MAX_JOURNAL_EVENTS, replayJournal } from './journal';
import { decodePeerView, encodePeerView, validatePeerUpdate, type PeerView } from './peer-view';

export const JOURNAL_CHUNK_SIZE = 8192;
export const MAX_JOURNAL_CHUNKS = 96;
export const MAX_PEER_JOURNAL = JOURNAL_CHUNK_SIZE * MAX_JOURNAL_CHUNKS;
function exact(
  value: unknown,
  required: string[],
  optional: string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !required.every((key) => Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error('INVALID_PEER_JOURNAL');
}
function name(value: unknown) {
  return (
    typeof value === 'string' && !!value.trim() && value.length <= 120 && !/\p{Cc}/u.test(value)
  );
}
// The journal is transient on readers. Only game snapshots and authoritative events cross this boundary.
export function encodePeerJournal(match: MatchRecord, events: readonly ScoreEventRecord[]): string {
  const text = JSON.stringify({
    protocol: 1,
    type: 'journal',
    match: {
      id: match.id,
      gameVersionId: match.gameVersionId,
      organizerPlayerId: match.organizerPlayerId,
      mode: match.mode,
      status: match.status,
      version: match.version,
      settingsSnapshot: Object.fromEntries(
        Object.entries(match.settingsSnapshot).filter(([key]) =>
          ['engineConfig', 'dartsMatch', 'target', 'firstThrowOwnerId', 'boulesPerPlayer'].includes(
            key,
          ),
        ),
      ),
      rulesSnapshot: match.rulesSnapshot,
      playersSnapshot: match.playersSnapshot.map(({ id, displayName, color, isGuest }) => ({
        id,
        displayName,
        color,
        isGuest,
      })),
      teamsSnapshot: match.teamsSnapshot.map(({ id, name, color, playerIds }) => ({
        id,
        name,
        color,
        playerIds,
      })),
      createdAt: match.createdAt,
      updatedAt: match.updatedAt,
    },
    events,
  });
  decodePeerJournal(text);
  return text;
}
export function decodePeerJournal(text: string) {
  if (typeof text !== 'string' || text.length > MAX_PEER_JOURNAL)
    throw new Error('INVALID_PEER_JOURNAL');
  const packet = JSON.parse(text);
  // Bound the parsed tree before recursive engine traversal and forbid prototype-bearing keys.
  const pending = [{ value: packet, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++nodes > 60000 || depth > 24) throw new Error('INVALID_PEER_JOURNAL');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (!safeKey(key)) throw new Error('INVALID_PEER_JOURNAL');
        pending.push({ value: child, depth: depth + 1 });
      }
    } else if (typeof value === 'string' && value.length > 4096)
      throw new Error('INVALID_PEER_JOURNAL');
  }
  exact(packet, ['protocol', 'type', 'match', 'events']);
  if (
    packet.protocol !== 1 ||
    packet.type !== 'journal' ||
    !Array.isArray(packet.events) ||
    packet.events.length > MAX_JOURNAL_EVENTS
  )
    throw new Error('INVALID_PEER_JOURNAL');
  exact(packet.match, [
    'id',
    'gameVersionId',
    'organizerPlayerId',
    'mode',
    'status',
    'version',
    'settingsSnapshot',
    'rulesSnapshot',
    'playersSnapshot',
    'teamsSnapshot',
    'createdAt',
    'updatedAt',
  ]);
  const match = packet.match as unknown as MatchRecord;
  if (
    ![match.id, match.gameVersionId, match.organizerPlayerId].every(journalId) ||
    !journalTimestamp(match.createdAt) ||
    !journalTimestamp(match.updatedAt) ||
    !Array.isArray(match.playersSnapshot) ||
    match.playersSnapshot.length < 1 ||
    match.playersSnapshot.length > 256 ||
    !Array.isArray(match.teamsSnapshot) ||
    match.teamsSnapshot.length > 64
  )
    throw new Error('INVALID_PEER_JOURNAL');
  for (const player of match.playersSnapshot) {
    exact(player, ['id', 'displayName', 'color', 'isGuest']);
    if (
      !journalId(player.id) ||
      !name(player.displayName) ||
      typeof player.isGuest !== 'boolean' ||
      typeof player.color !== 'string' ||
      !/^#[a-fA-F0-9]{6}$/.test(player.color)
    )
      throw new Error('INVALID_PEER_JOURNAL');
  }
  for (const team of match.teamsSnapshot) {
    exact(team, ['id', 'name', 'color', 'playerIds']);
    if (
      !journalId(team.id) ||
      !name(team.name) ||
      typeof team.color !== 'string' ||
      !/^#[a-fA-F0-9]{6}$/.test(team.color) ||
      !Array.isArray(team.playerIds) ||
      team.playerIds.length > 256 ||
      !team.playerIds.every(journalId)
    )
      throw new Error('INVALID_PEER_JOURNAL');
  }
  exact(
    match.settingsSnapshot,
    [],
    ['engineConfig', 'dartsMatch', 'target', 'firstThrowOwnerId', 'boulesPerPlayer'],
  );
  exact(
    match.rulesSnapshot,
    ['id', 'gameId', 'rulesetVersion', 'schemaVersion', 'definition', 'publishedAt'],
    ['name'],
  );
  copyBoundedJson(match.settingsSnapshot);
  const events = packet.events.map((event: unknown) => {
    exact(
      event,
      [
        'id',
        'matchId',
        'sequence',
        'commandId',
        'actorPlayerId',
        'deviceId',
        'timestamp',
        'payload',
      ],
      ['supersedesId'],
    );
    return copyBoundedJson(event) as unknown as ScoreEventRecord;
  });
  const journal = replayJournal(match, events);
  if (journal.projection.status !== match.status) throw new Error('INVALID_PEER_JOURNAL');
  const view = decodePeerView(encodePeerView(match, journal.projection));
  return immutable({ match, events, journal, view });
}
export function verifyPeerJournal(text: string, expected: Readonly<PeerView>) {
  const result = decodePeerJournal(text);
  validatePeerUpdate(expected, result.view);
  return result;
}
export function journalParts(text: string, requestId: string): string[] {
  if (!journalId(requestId) || !text.length || text.length > MAX_PEER_JOURNAL)
    throw new Error('INVALID_PEER_JOURNAL');
  const count = Math.ceil(text.length / JOURNAL_CHUNK_SIZE);
  return Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      type: 'journal_part',
      requestId,
      index,
      count,
      text: text.slice(index * JOURNAL_CHUNK_SIZE, (index + 1) * JOURNAL_CHUNK_SIZE),
    }),
  );
}
export class JournalAssembly {
  private pieces: string[] = [];
  private count = 0;
  constructor(
    readonly requestId: string,
    private readonly startedAt: number,
  ) {}
  accept(text: string, now: number): string | undefined {
    if (text.length > 65536 || now - this.startedAt > 15000 || now < this.startedAt)
      throw new Error('INVALID_JOURNAL_PART');
    const part = JSON.parse(text);
    exact(part, ['type', 'requestId', 'index', 'count', 'text']);
    if (
      part.type !== 'journal_part' ||
      part.requestId !== this.requestId ||
      typeof part.index !== 'number' ||
      !Number.isSafeInteger(part.index) ||
      part.index !== this.pieces.length ||
      (typeof part.count === 'number' && part.index >= part.count) ||
      typeof part.count !== 'number' ||
      !Number.isSafeInteger(part.count) ||
      part.count < 1 ||
      part.count > MAX_JOURNAL_CHUNKS ||
      (this.count && part.count !== this.count) ||
      typeof part.text !== 'string' ||
      !part.text.length ||
      part.text.length > JOURNAL_CHUNK_SIZE ||
      (part.index < part.count - 1 && part.text.length !== JOURNAL_CHUNK_SIZE)
    )
      throw new Error('INVALID_JOURNAL_PART');
    this.count = part.count;
    this.pieces.push(part.text);
    if (this.pieces.length === this.count) return this.pieces.join('');
  }
}
