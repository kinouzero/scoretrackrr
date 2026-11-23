import { isScoreSheet, scoreSheetVersion } from '#lib/domain/games/score-sheets';
import type { GameRecord, GameVersionRecord, JsonObject } from '#lib/domain/records';
import { decodeGameTransfer, encodeGameTransfer } from '#lib/domain/games/transfer';
import { catalogGameId, gameCatalog } from '#lib/domain/games/catalog';
import { petanqueVersion } from '#lib/domain/games/petanque';
import { cricketVersion } from '#lib/domain/games/cricket';
import { x01Version } from '#lib/domain/games/darts';
import { farkleVersion } from '#lib/domain/games/farkle';
import { four21Version } from '#lib/domain/games/four21';
import { timesUpVersion } from '#lib/domain/games/times-up';
import { sixNimmtVersion } from '#lib/domain/games/six-nimmt';
import { molkkyVersion } from '#lib/domain/games/molkky';
import { flip7Version } from '#lib/domain/games/flip7';
import { skullKingVersion } from '#lib/domain/games/skull-king';
import { yamsVersion } from '#lib/domain/games/yams';
import { counterDefinition, type CounterSettings } from '#lib/domain/games/counter';
import { copyBoundedJson } from '#lib/domain/engine/validation';
import { createDeclarativeGame } from '#lib/domain/engine/declarative';
import { journalId, journalTimestamp } from '#lib/domain/journal';
import type { LocalDatabase } from './database';
import { requireRecord, StorageError, storageOperation, validateRecord } from './errors';

const x01Ids = [301, 501].flatMap((start) =>
  [true, false].map((doubleOut) => x01Version(start, doubleOut, '').id),
);
const cricketIds = [true, false].map((points) => cricketVersion(points, '').id);

export class CatalogRepository {
  constructor(private readonly db: LocalDatabase) {}

  async initialize(publishedAt: string) {
    validateRecord(journalTimestamp(publishedAt));
    const db = this.db;
    await storageOperation(() =>
      db.transaction('rw', [db.games, db.gameVersions, db.variants], async () => {
        for (const builtin of gameCatalog) {
          if (isScoreSheet(builtin.id)) {
            const version = scoreSheetVersion(builtin.id, publishedAt);
            const stored = await db.gameVersions.get(version.id);
            if (!stored) await db.gameVersions.add(version);
            else if (JSON.stringify(stored.definition) !== JSON.stringify(version.definition))
              throw new StorageError('conflict');
          }
          const current = await db.games.get(builtin.id);
          if (current?.origin === 'custom' || (current && current.slug !== builtin.id))
            throw new StorageError('conflict');
          if (!current || current.state !== builtin.state || current.name !== builtin.name)
            await db.games.put({
              ...current,
              id: builtin.id,
              slug: builtin.id,
              name: builtin.name,
              state: builtin.state,
              origin: 'builtin',
            });
        }
        for (const mode of ['individual', 'teams'] as const)
          for (const target of [11, 13] as const) {
            const version = petanqueVersion(target, publishedAt, mode);
            const current = await db.gameVersions.get(version.id);
            if (!current) await db.gameVersions.add(version);
            else if (
              current.gameId !== version.gameId ||
              current.rulesetVersion !== version.rulesetVersion ||
              JSON.stringify(current.definition) !== JSON.stringify(version.definition)
            )
              throw new StorageError('conflict');
            const id = `petanque-${mode}-${target}`;
            if (!(await db.variants.get(id)))
              await db.variants.add({
                id,
                gameVersionId: version.id,
                name: `${mode}-${target}`,
                settings: { target, boulesPerPlayer: 3 },
              });
          }
        for (const target of [5000, 10000] as const)
          for (const entry of [0, 500] as const) {
            const version = farkleVersion(target, entry, publishedAt);
            const stored = await db.gameVersions.get(version.id);
            if (!stored) await db.gameVersions.add(version);
            else if (JSON.stringify(stored.definition) !== JSON.stringify(version.definition))
              throw new StorageError('conflict');
          }
        for (const start of [301, 501] as const)
          for (const doubleOut of [true, false]) {
            const version = x01Version(start, doubleOut, publishedAt);
            const stored = await db.gameVersions.get(version.id);
            if (!stored) await db.gameVersions.add(version);
            else if (JSON.stringify(stored.definition) !== JSON.stringify(version.definition))
              throw new StorageError('conflict');
          }
        for (const points of [true, false]) {
          const version = cricketVersion(points, publishedAt);
          const stored = await db.gameVersions.get(version.id);
          if (!stored) await db.gameVersions.add(version);
          else if (JSON.stringify(stored.definition) !== JSON.stringify(version.definition))
            throw new StorageError('conflict');
        }
        const timesUp = timesUpVersion(publishedAt);
        const storedTimesUp = await db.gameVersions.get(timesUp.id);
        if (!storedTimesUp) await db.gameVersions.add(timesUp);
        else if (JSON.stringify(storedTimesUp.definition) !== JSON.stringify(timesUp.definition))
          throw new StorageError('conflict');
        const sixNimmt = sixNimmtVersion(publishedAt);
        const storedSixNimmt = await db.gameVersions.get(sixNimmt.id);
        if (!storedSixNimmt) await db.gameVersions.add(sixNimmt);
        else if (JSON.stringify(storedSixNimmt.definition) !== JSON.stringify(sixNimmt.definition))
          throw new StorageError('conflict');
        const molkky = molkkyVersion(publishedAt);
        const storedMolkky = await db.gameVersions.get(molkky.id);
        if (!storedMolkky) await db.gameVersions.add(molkky);
        else if (JSON.stringify(storedMolkky.definition) !== JSON.stringify(molkky.definition))
          throw new StorageError('conflict');
        const flip = flip7Version(publishedAt);
        const savedFlip = await db.gameVersions.get(flip.id);
        if (!savedFlip) await db.gameVersions.add(flip);
        else if (JSON.stringify(savedFlip.definition) !== JSON.stringify(flip.definition))
          throw new StorageError('conflict');
        const skull = skullKingVersion(publishedAt);
        const savedSkull = await db.gameVersions.get(skull.id);
        if (!savedSkull) await db.gameVersions.add(skull);
        else if (JSON.stringify(savedSkull.definition) !== JSON.stringify(skull.definition))
          throw new StorageError('conflict');
        const four21 = four21Version(publishedAt);
        const stored421 = await db.gameVersions.get(four21.id);
        if (!stored421) await db.gameVersions.add(four21);
        else if (JSON.stringify(stored421.definition) !== JSON.stringify(four21.definition))
          throw new StorageError('conflict');
        for (const upperBonus of [true, false]) {
          const version = yamsVersion(upperBonus, publishedAt);
          const current = await db.gameVersions.get(version.id);
          if (!current) await db.gameVersions.add(version);
          else if (JSON.stringify(current.definition) !== JSON.stringify(version.definition))
            throw new StorageError('conflict');
        }
      }),
    );
  }

  async list({
    search = '',
    state = 'all',
    favorites = false,
    page = 0,
  }: {
    search?: string;
    state?: 'all' | 'available' | 'coming_soon';
    favorites?: boolean;
    page?: number;
  } = {}) {
    validateRecord(search.length <= 120 && Number.isSafeInteger(page) && page >= 0);
    const db = this.db;
    return storageOperation(() =>
      db.transaction('r', [db.games, db.gameVersions], async () => {
        const term = search.trim();
        const query = ['darts', 'fléchettes', 'flechettes'].includes(term.toLowerCase())
          ? db.games.where('name').anyOf(['Cricket', 'X01'])
          : term
            ? db.games.where('name').startsWithIgnoreCase(term)
            : db.games.orderBy('name');
        const rows = await query
          .filter(
            (game) =>
              (state === 'all' || game.state === state) && (!favorites || game.favorite === true),
          )
          .offset(page * 24)
          .limit(25)
          .toArray();
        const items = rows.slice(0, 24);
        const ids = items.flatMap((game) =>
          isScoreSheet(game.id)
            ? [scoreSheetVersion(game.id, '').id]
            : game.id === 'petanque'
              ? (['individual', 'teams'] as const).flatMap((mode) =>
                  ([11, 13] as const).map((target) => petanqueVersion(target, '', mode).id),
                )
              : game.id === 'times-up'
                ? [timesUpVersion('').id]
                : game.id === '6-qui-prend'
                  ? [sixNimmtVersion('').id]
                  : game.id === 'molkky'
                    ? [molkkyVersion('').id]
                    : game.id === 'flip-7'
                      ? [flip7Version('').id]
                      : game.id === 'skull-king'
                        ? [skullKingVersion('').id]
                        : game.id === 'darts' || game.id === 'cricket'
                          ? game.id === 'cricket'
                            ? cricketIds
                            : x01Ids
                          : game.id === '5000-10000'
                            ? ([5000, 10000] as const).flatMap((target) =>
                                ([500, 0] as const).map(
                                  (entry) => farkleVersion(target, entry, '').id,
                                ),
                              )
                            : game.id === '421'
                              ? [four21Version('').id]
                              : game.id === 'yams'
                                ? [yamsVersion(true, '').id, yamsVersion(false, '').id]
                                : game.currentVersionId
                                  ? [game.currentVersionId]
                                  : [],
        );
        const versions = (await db.gameVersions.bulkGet(ids)).filter(
          (version): version is GameVersionRecord => !!version,
        );
        return {
          items: items.map((game) => ({
            ...game,
            versions: versions.filter((version) => catalogGameId(version) === game.id),
          })),
          hasMore: rows.length > 24,
        };
      }),
    );
  }

  async setFavorite(id: string, favorite: boolean) {
    validateRecord(typeof favorite === 'boolean');
    const db = this.db;
    await storageOperation(() =>
      db.transaction('rw', db.games, async () => {
        const game = requireRecord(await db.games.get(id));
        await db.games.put({ ...game, favorite });
      }),
    );
  }

  async readVersion(id: string) {
    return storageOperation(async () => requireRecord(await this.db.gameVersions.get(id)));
  }

  async readSetupVersions(id: string) {
    const db = this.db;
    return storageOperation(() =>
      db.transaction('r', db.gameVersions, async () => {
        const selected = requireRecord(await db.gameVersions.get(id));
        const presetIds =
          selected.gameId === 'yams'
            ? [yamsVersion(true, '').id, yamsVersion(false, '').id]
            : selected.gameId === 'darts'
              ? catalogGameId(selected) === 'cricket'
                ? cricketIds
                : x01Ids
              : undefined;
        const versions = presetIds
          ? (await db.gameVersions.bulkGet(presetIds)).filter(
              (version): version is GameVersionRecord => !!version,
            )
          : await db.gameVersions.where('gameId').equals(selected.gameId).limit(101).toArray();
        if (presetIds && !versions.some((version) => version.id === selected.id))
          versions.push(selected);
        validateRecord(versions.length <= 100);
        versions.sort(
          (a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id),
        );
        return { selected, versions };
      }),
    );
  }

  async exportVersion(versionId: string) {
    const version = await this.readVersion(versionId);
    const game = requireRecord(await this.db.games.get(version.gameId));
    return encodeGameTransfer(version, version.name ?? game.name);
  }

  async importGame(
    text: string,
    identity: { gameId: string; versionId: string; rulesetVersion: string; publishedAt: string },
  ) {
    const data = decodeGameTransfer(text);
    if (data.gameId.startsWith('custom-')) {
      const definition = {
        ...data.definition,
        id: identity.gameId,
        rulesetVersion: identity.rulesetVersion,
      };
      return this.publishDefinition({ ...identity, name: data.name, definition });
    }
    await this.initialize(identity.publishedAt);
    return storageOperation(async () => {
      const version = requireRecord(
        await this.db.gameVersions
          .where('[gameId+rulesetVersion]')
          .equals([data.gameId, data.rulesetVersion])
          .first(),
      );
      validateRecord(JSON.stringify(version.definition) === JSON.stringify(data.definition));
      return version;
    });
  }

  async publishCounter(
    input: CounterSettings & {
      gameId: string;
      versionId: string;
      rulesetVersion: string;
      name: string;
      publishedAt: string;
      expectedVersionId?: string;
    },
  ) {
    return this.publishDefinition({
      ...input,
      definition: counterDefinition(input.gameId, input.rulesetVersion, input),
    });
  }

  async publishDefinition(submission: {
    gameId: string;
    versionId: string;
    rulesetVersion: string;
    name: string;
    publishedAt: string;
    expectedVersionId?: string;
    definition: unknown;
  }) {
    const input = copyBoundedJson(submission) as typeof submission;
    validateRecord(
      /^custom-[a-f0-9-]{36}$/.test(input.gameId) &&
        journalId(input.versionId) &&
        journalTimestamp(input.publishedAt) &&
        input.name.trim().length > 0 &&
        input.name.trim().length <= 120 &&
        !/\p{Cc}/u.test(input.name),
    );
    const definition = createDeclarativeGame(input.definition).definition;
    validateRecord(
      definition.id === input.gameId && definition.rulesetVersion === input.rulesetVersion,
    );
    const db = this.db;
    return storageOperation(() =>
      db.transaction('rw', [db.games, db.gameVersions], async () => {
        const current = await db.games.get(input.gameId);
        if (
          (current &&
            (current.origin !== 'custom' ||
              current.currentVersionId !== input.expectedVersionId)) ||
          (!current && input.expectedVersionId)
        )
          throw new StorageError('conflict');
        if ((await db.gameVersions.where('gameId').equals(input.gameId).count()) >= 100)
          throw new StorageError('invalid_record');
        const version: GameVersionRecord = {
          id: input.versionId,
          gameId: input.gameId,
          rulesetVersion: definition.rulesetVersion,
          schemaVersion: 1,
          definition: definition as unknown as JsonObject,
          publishedAt: input.publishedAt,
          name: input.name.trim(),
        };
        // add, never put: earlier published rules and match snapshots stay immutable.
        await db.gameVersions.add(version);
        const game: GameRecord = {
          ...current,
          id: input.gameId,
          slug: input.gameId,
          name: input.name.trim(),
          origin: 'custom',
          state: 'available',
          currentVersionId: version.id,
        };
        await db.games.put(game);
        createDeclarativeGame(version.definition);
        return version;
      }),
    );
  }
}
