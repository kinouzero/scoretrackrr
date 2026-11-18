import { copyBoundedJson, immutable } from './engine/validation';
import { createGame } from './games/engine';
import type {
  GameVersionRecord,
  MatchRecord,
  MatchProjectionRecord,
  JsonObject,
  MatchMode,
} from './records';
export interface PeerView {
  protocol: 1;
  type: 'view';
  matchId: string;
  version: number;
  status: MatchRecord['status'];
  mode: MatchMode;
  rules: GameVersionRecord;
  options: JsonObject | null;
  owners: { id: string; name: string; total: number }[];
  winnerIds: string[];
}
export function decodePeerView(text: string): Readonly<PeerView> {
  if (typeof text !== 'string' || text.length > 65536) throw new Error('INVALID_VIEW');
  let value: PeerView;
  try {
    value = copyBoundedJson(JSON.parse(text)) as PeerView;
  } catch {
    throw new Error('INVALID_VIEW');
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).length !== 10 ||
    value.protocol !== 1 ||
    value.type !== 'view' ||
    typeof value.matchId !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.matchId) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    !['draft', 'in_progress', 'paused', 'finished', 'cancelled'].includes(value.status) ||
    !Array.isArray(value.owners) ||
    value.owners.length < 1 ||
    value.owners.length > 64 ||
    value.owners.some(
      (owner) =>
        !owner ||
        Object.keys(owner).length !== 3 ||
        typeof owner.id !== 'string' ||
        typeof owner.name !== 'string' ||
        owner.name.length > 120 ||
        typeof owner.total !== 'number' ||
        !Number.isFinite(owner.total) ||
        Math.abs(owner.total) > 1e12,
    ) ||
    !Array.isArray(value.winnerIds) ||
    (value.status === 'finished' ? value.winnerIds.length === 0 : value.winnerIds.length !== 0) ||
    new Set(value.winnerIds).size !== value.winnerIds.length ||
    value.winnerIds.some((id) => !value.owners.some((owner) => owner.id === id))
  )
    throw new Error('INVALID_VIEW');
  if (
    !value.rules ||
    typeof value.rules !== 'object' ||
    !['id', 'gameId', 'rulesetVersion', 'schemaVersion', 'definition', 'publishedAt'].every((key) =>
      Object.hasOwn(value.rules, key),
    ) ||
    Object.keys(value.rules).some(
      (key) =>
        ![
          'id',
          'gameId',
          'rulesetVersion',
          'schemaVersion',
          'definition',
          'publishedAt',
          'name',
        ].includes(key),
    ) ||
    typeof value.rules.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.rules.id) ||
    typeof value.rules.publishedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.rules.publishedAt)) ||
    (value.rules.name !== undefined &&
      (typeof value.rules.name !== 'string' ||
        !value.rules.name.trim() ||
        value.rules.name.length > 120 ||
        /\p{Cc}/u.test(value.rules.name))) ||
    (value.options !== null && value.rules.gameId !== 'darts')
  )
    throw new Error('INVALID_VIEW');
  const game = createGame(value.rules, value.options ?? undefined);
  if (
    game.id !== value.rules.gameId ||
    game.rulesetVersion !== value.rules.rulesetVersion ||
    game.definition.schemaVersion !== value.rules.schemaVersion
  )
    throw new Error('INVALID_VIEW');
  game.validateConfig({ mode: value.mode, ownerIds: value.owners.map((owner) => owner.id) });
  return immutable(value);
}
export function encodePeerView(match: MatchRecord, projection: MatchProjectionRecord) {
  const rules = match.rulesSnapshot;
  const text = JSON.stringify({
    protocol: 1,
    type: 'view',
    matchId: match.id,
    version: projection.lastEventSequence,
    status: projection.status,
    mode: match.mode,
    rules: {
      id: rules.id,
      gameId: rules.gameId,
      rulesetVersion: rules.rulesetVersion,
      schemaVersion: rules.schemaVersion,
      definition: rules.definition,
      publishedAt: rules.publishedAt,
      ...(rules.name ? { name: rules.name } : {}),
    },
    options: match.settingsSnapshot.dartsMatch ?? null,
    owners: Object.entries(projection.totals).map(([id, total]) => ({
      id,
      total,
      name:
        match.teamsSnapshot.find((team) => team.id === id)?.name ??
        match.playersSnapshot.find((player) => player.id === id)?.displayName ??
        id,
    })),
    winnerIds: projection.winnerIds ?? [],
  });
  decodePeerView(text);
  return text;
}

// A paired reader pins one match identity and immutable rules for the entire session.
export function validatePeerUpdate(
  previous: Readonly<PeerView> | undefined,
  next: Readonly<PeerView>,
) {
  if (!previous) return next;
  const identity = (view: Readonly<PeerView>) =>
    JSON.stringify({
      matchId: view.matchId,
      mode: view.mode,
      rules: view.rules,
      options: view.options,
      owners: view.owners.map(({ id, name }) => ({ id, name })),
    });
  if (
    next.version < previous.version ||
    identity(next) !== identity(previous) ||
    (next.version === previous.version && JSON.stringify(next) !== JSON.stringify(previous))
  )
    throw new Error('INVALID_VERSION');
  return next;
}
