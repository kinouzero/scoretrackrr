import { describe, expect, it } from 'vitest';
import {
  normalizePlayerProfile,
  playerInitials,
  type PlayerProfileInput,
} from '../../src/lib/domain/players';

const profile = { displayName: '  Zoé Martin  ', color: '#AABBCC', isGuest: false };
describe('local player profiles', () => {
  it('normalizes a profile and defaults missing avatars without changing its name', () => {
    expect(normalizePlayerProfile(profile)).toMatchObject({
      displayName: 'Zoé Martin',
      color: '#aabbcc',
      avatar: 'initials',
      isGuest: false,
    });
    expect(playerInitials(' Zoé   Martin ')).toBe('ZM');
    expect(playerInitials('Élodie')).toBe('É');
  });
  it.each(['', '  ', 'a'.repeat(121), 'Two\nlines'])(
    'rejects invalid display names',
    (displayName) => {
      expect(() => normalizePlayerProfile({ ...profile, displayName })).toThrow();
    },
  );
  it('requires valid appearance values and avoids arbitrary remote or SVG image sources', () => {
    expect(() =>
      normalizePlayerProfile({ ...profile, color: 'red;url(https://example.com)' }),
    ).toThrow();
    expect(() =>
      normalizePlayerProfile({ ...profile, avatar: '__proto__' as PlayerProfileInput['avatar'] }),
    ).toThrow();
    expect(() =>
      normalizePlayerProfile({
        ...profile,
        avatar: 'gravatar',
        email: 'a@example.com',
        avatarImage: 'data:image/svg+xml;base64,PHN2Zz4=',
      }),
    ).toThrow();
  });
  it('normalizes Gravatar emails and requires a saved profile with a valid address', () => {
    expect(
      normalizePlayerProfile({ ...profile, avatar: 'gravatar', email: ' Example@EXAMPLE.COM ' })
        .email,
    ).toBe('example@example.com');
    expect(() => normalizePlayerProfile({ ...profile, avatar: 'gravatar' })).toThrow();
    expect(() => normalizePlayerProfile({ ...profile, email: 'invalid' })).toThrow();
    expect(() =>
      normalizePlayerProfile({
        ...profile,
        avatar: 'gravatar',
        email: 'a@example.com',
        isGuest: true,
      }),
    ).toThrow();
  });
  it('removes saved email and image information when changing to a guest or local avatar', () => {
    expect(
      normalizePlayerProfile({ ...profile, email: 'a@example.com', isGuest: true }).email,
    ).toBeUndefined();
    expect(
      normalizePlayerProfile({
        ...profile,
        avatar: 'sun',
        avatarImage: 'data:image/png;base64,AAAA',
      }).avatarImage,
    ).toBeUndefined();
  });
});
