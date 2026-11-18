import type { PlayerRecord } from './records';
export const playerAvatars = {
  initials: '',
  sun: '☀',
  moon: '☾',
  star: '★',
  leaf: '❧',
  dice: '⚄',
  gravatar: '',
} as const;
export type PlayerAvatar = keyof typeof playerAvatars;

export interface PlayerProfileInput {
  readonly displayName: string;
  readonly color: string;
  readonly isGuest: boolean;
  readonly avatar?: PlayerAvatar;
  readonly email?: string;
  readonly avatarImage?: string;
}

export class PlayerValidationError extends Error {
  constructor(readonly field: 'displayName' | 'color' | 'avatar' | 'isGuest' | 'email') {
    super(`INVALID_PLAYER_${field}`);
    this.name = 'PlayerValidationError';
  }
}

export function normalizePlayerProfile(input: PlayerProfileInput) {
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (!displayName || displayName.length > 120 || /\p{Cc}/u.test(displayName))
    throw new PlayerValidationError('displayName');
  if (typeof input.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(input.color))
    throw new PlayerValidationError('color');
  const avatar = input.avatar ?? 'initials';
  if (!Object.hasOwn(playerAvatars, avatar)) throw new PlayerValidationError('avatar');
  if (typeof input.isGuest !== 'boolean') throw new PlayerValidationError('isGuest');
  const email = input.isGuest ? undefined : input.email?.trim().toLowerCase() || undefined;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    throw new PlayerValidationError('email');
  if (avatar === 'gravatar' && (input.isGuest || !email)) throw new PlayerValidationError('email');
  const avatarImage = avatar === 'gravatar' ? input.avatarImage : undefined;
  if (
    avatarImage &&
    (avatarImage.length > 180_000 ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatarImage))
  )
    throw new PlayerValidationError('avatar');
  return {
    displayName,
    color: input.color.toLowerCase(),
    avatar,
    isGuest: input.isGuest,
    email,
    avatarImage,
  };
}

export function playerInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toLocaleUpperCase('fr-FR');
}

// Old archives become existing profiles; only an explicit deletion creates a tombstone.
export function restoreLegacyPlayer(player: PlayerRecord): PlayerRecord {
  if (!player.archivedAt) return player;
  const active = { ...player, revision: (player.revision ?? 0) + 1 };
  delete active.archivedAt;
  return active;
}
