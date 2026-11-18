import Dexie, { type Table } from 'dexie';
import {
  normalizeDeviceName,
  normalizeTheme,
  normalizeLanguagePreference,
  type ThemePreference,
} from '#lib/domain/settings';
import type {
  PlayerRecord,
  TeamRecord,
  TeamMembershipRecord,
  GameRecord,
  GameVersionRecord,
  VariantRecord,
  MatchRecord,
  RoundRecord,
  ScoreEventRecord,
  MatchProjectionRecord,
  MatchPermissionRecord,
  MatchAuthorityRecord,
  PeerReplicaRecord,
} from '#lib/domain/records';
import { storageOperation } from './errors';
import { restoreLegacyPlayer } from '#lib/domain/players';
import { makeTeamReusable, restoreLegacyTeam } from '#lib/domain/teams';

interface DeviceSetting {
  key: 'deviceName' | 'deviceId' | 'theme' | 'language';
  value: string;
}

// Construct only in the browser (or with an injected IndexedDB test environment).
export class LocalDatabase extends Dexie {
  deviceSettings!: Table<DeviceSetting, string>;
  players!: Table<PlayerRecord, string>;
  teams!: Table<TeamRecord, string>;
  teamMemberships!: Table<TeamMembershipRecord, string>;
  games!: Table<GameRecord, string>;
  gameVersions!: Table<GameVersionRecord, string>;
  variants!: Table<VariantRecord, string>;
  matches!: Table<MatchRecord, string>;
  rounds!: Table<RoundRecord, string>;
  scoreEvents!: Table<ScoreEventRecord, string>;
  matchProjections!: Table<MatchProjectionRecord, string>;
  matchPermissions!: Table<MatchPermissionRecord, [string, string]>;

  matchAuthorities!: Table<MatchAuthorityRecord, string>;
  peerReplicas!: Table<PeerReplicaRecord, string>;

  constructor(name = 'scoretrackrr') {
    super(name);
    this.version(1).stores({ deviceSettings: '&key' });
    // Additive upgrade: preserve every v1 setting; never recreate or clear stores.
    this.version(2).stores({
      players: '&id, displayName, archivedAt',
      teams: '&id, name, archivedAt',
      teamMemberships: '&id, teamId, playerId, [teamId+playerId]',
      games: '&id, &slug, state',
      gameVersions: '&id, gameId, &[gameId+rulesetVersion]',
      variants: '&id, gameVersionId',
      matches: '&id, status, gameVersionId, createdAt, updatedAt',
      rounds: '&id, matchId, &[matchId+sequence]',
      scoreEvents: '&id, &[matchId+sequence], &[matchId+commandId], roundId',
      matchProjections: '&matchId',
      matchPermissions: '[matchId+playerId], matchId',
    });
    // Index-only upgrade: preserve all records and unknown optional metadata.
    this.version(3).stores({ games: '&id, &slug, name, state' });
    this.version(4).stores({ matchAuthorities: '&matchId', peerReplicas: '&id, matchId' });
    this.version(5)
      .stores({})
      .upgrade((transaction) =>
        transaction
          .table<TeamRecord>('teams')
          .toCollection()
          .modify((team, context) => {
            context.value = makeTeamReusable(team);
          }),
      );
    this.version(6)
      .stores({})
      .upgrade((transaction) =>
        transaction
          .table<PlayerRecord>('players')
          .toCollection()
          .modify((player, context) => {
            context.value = restoreLegacyPlayer(player);
          }),
      );
    this.version(7)
      .stores({})
      .upgrade((transaction) =>
        transaction
          .table<TeamRecord>('teams')
          .toCollection()
          .modify((team, context) => {
            context.value = restoreLegacyTeam(team);
          }),
      );
    this.on('versionchange', () => this.close());
  }

  async readDeviceName(): Promise<string> {
    return storageOperation(async () => (await this.deviceSettings.get('deviceName'))?.value ?? '');
  }

  async readLanguage(): Promise<string> {
    return storageOperation(async () =>
      normalizeLanguagePreference((await this.deviceSettings.get('language'))?.value ?? 'system'),
    );
  }

  async saveLanguage(input: unknown): Promise<void> {
    const value = normalizeLanguagePreference(input);
    await storageOperation(async () => {
      await this.deviceSettings.put({ key: 'language', value });
    });
  }

  async readTheme(): Promise<ThemePreference> {
    return storageOperation(async () =>
      normalizeTheme((await this.deviceSettings.get('theme'))?.value ?? 'system'),
    );
  }

  async saveTheme(input: unknown): Promise<void> {
    const value = normalizeTheme(input);
    await storageOperation(async () => {
      await this.deviceSettings.put({ key: 'theme', value });
    });
  }

  async saveDeviceName(input: string): Promise<void> {
    const value = normalizeDeviceName(input);
    await storageOperation(async () => {
      await this.deviceSettings.put({ key: 'deviceName', value });
    });
  }

  async readOrCreateDeviceId(candidate: string): Promise<string> {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(candidate)) throw new TypeError('Invalid device ID');
    return storageOperation(() =>
      this.transaction('rw', this.deviceSettings, async () => {
        const current = await this.deviceSettings.get('deviceId');
        if (current) return current.value;
        await this.deviceSettings.add({ key: 'deviceId', value: candidate });
        return candidate;
      }),
    );
  }
}
