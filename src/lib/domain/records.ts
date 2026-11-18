import type { PlayerAvatar } from './players';
import type { TeamAvatar, TeamFormat, TeamKind } from './teams';

export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface PlayerRecord {
  readonly id: string;
  readonly displayName: string;
  readonly color: string;
  readonly isGuest: boolean;
  readonly avatar?: PlayerAvatar;
  readonly revision?: number;
  readonly email?: string;
  readonly avatarImage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly deletedAt?: string;
}

export interface TeamRecord {
  readonly deletedAt?: string;
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly avatar?: TeamAvatar;
  readonly kind?: TeamKind;
  readonly format?: TeamFormat;
  readonly revision?: number;
  readonly memberOrder?: readonly string[];
  readonly assignedMatchId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string;
}

export interface TeamMembershipRecord {
  readonly id: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly joinedAt: string;
  readonly leftAt?: string;
}

export interface GameRecord {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly state: 'available' | 'coming_soon';
  readonly origin?: 'builtin' | 'custom';
  readonly favorite?: boolean;
  readonly currentVersionId?: string;
}

export interface GameVersionRecord {
  readonly id: string;
  readonly gameId: string;
  readonly rulesetVersion: string;
  readonly schemaVersion: number;
  readonly definition: JsonObject;
  readonly publishedAt: string;
  readonly name?: string;
}

export interface VariantRecord {
  readonly id: string;
  readonly gameVersionId: string;
  readonly name: string;
  readonly settings: JsonObject;
}

export type MatchStatus = 'draft' | 'in_progress' | 'paused' | 'finished' | 'cancelled';
export type MatchMode = 'individual' | 'teams' | 'cooperative' | 'mixed';
export type PlayerSnapshot = Pick<
  PlayerRecord,
  'id' | 'displayName' | 'color' | 'isGuest' | 'avatar' | 'avatarImage'
>;
export interface TeamSnapshot {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly avatar?: TeamAvatar;
  readonly kind?: TeamKind;
  readonly format?: TeamFormat;
  readonly playerIds: readonly string[];
}

export interface MatchRecord {
  readonly id: string;
  readonly gameVersionId: string;
  readonly organizerPlayerId: string;
  readonly mode: MatchMode;
  readonly status: MatchStatus;
  readonly version: number;
  readonly settingsSnapshot: JsonObject;
  readonly rulesSnapshot: GameVersionRecord;
  readonly playersSnapshot: readonly PlayerSnapshot[];
  readonly teamsSnapshot: readonly TeamSnapshot[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoundRecord {
  readonly id: string;
  readonly matchId: string;
  readonly sequence: number;
  readonly status: 'open' | 'closed' | 'void';
}

export interface ScoreEventRecord {
  readonly id: string;
  readonly matchId: string;
  readonly roundId?: string;
  readonly sequence: number;
  readonly commandId: string;
  readonly actorPlayerId: string;
  readonly deviceId?: string;
  readonly payload: JsonObject;
  readonly supersedesId?: string;
  readonly timestamp: string;
}

export interface MatchProjectionRecord {
  readonly matchId: string;
  readonly lastEventSequence: number;
  readonly status: MatchStatus;
  readonly totals: Readonly<Record<string, number>>;
  readonly winnerId?: string;
  readonly winnerIds?: readonly string[];
}

export interface MatchPermissionRecord {
  readonly matchId: string;
  readonly playerId: string;
  readonly role: 'organizer' | 'manager' | 'scorer' | 'viewer';
  readonly grantedBy: string;
  readonly sessionId?: string;
  readonly revision: number;
}

export interface MatchAuthorityRecord {
  readonly matchId: string;
  readonly playerId: string;
  readonly deviceId: string;
  readonly epoch: number;
  readonly state: 'active' | 'prepared' | 'released';
  readonly transferId?: string;
  readonly targetPlayerId?: string;
  readonly targetSessionId?: string;
  readonly targetDeviceId?: string;
  readonly baseVersion?: number;
}
export interface PeerReplicaRecord {
  readonly id: string;
  readonly matchId: string;
  readonly deviceId: string;
  readonly baseVersion: number;
  readonly acceptedAt: string;
  readonly targetPlayerId: string;
  readonly text: string;
}
