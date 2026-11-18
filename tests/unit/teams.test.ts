import { describe, expect, it } from 'vitest';
import {
  distributePlayers,
  normalizeTeamProfile,
  TeamValidationError,
  type TeamProfileInput,
} from '../../src/lib/domain/teams';

const profile = { name: ' Blue team ', color: '#AABBCC' };
describe('team profiles and constraints', () => {
  it('normalizes legacy defaults and accepts exactly two players for doublette', () => {
    expect(normalizeTeamProfile(profile, ['a'])).toEqual({
      name: 'Blue team',
      color: '#aabbcc',
      avatar: 'initials',
      kind: 'permanent',
      format: 'free',
    });
    expect(
      normalizeTeamProfile({ ...profile, kind: 'temporary', format: 'petanque_doublette' }, [
        'a',
        'b',
      ]).kind,
    ).toBe('permanent');
  });
  it.each([{ ids: [] }, { ids: ['a'] }, { ids: ['a', 'a'] }, { ids: ['a', 'b', 'c'] }])(
    'rejects invalid doublette memberships',
    ({ ids }) => {
      expect(() => normalizeTeamProfile({ ...profile, format: 'petanque_doublette' }, ids)).toThrow(
        TeamValidationError,
      );
    },
  );
  it('rejects invalid names, remote avatars and excessive rosters', () => {
    expect(() => normalizeTeamProfile({ ...profile, name: ' \n ' }, ['a'])).toThrow();
    expect(() =>
      normalizeTeamProfile(
        { ...profile, avatar: 'https://example.com/image' as TeamProfileInput['avatar'] },
        ['a'],
      ),
    ).toThrow();
    expect(() =>
      normalizeTeamProfile(
        profile,
        Array.from({ length: 33 }, (_, index) => String(index)),
      ),
    ).toThrow();
  });
});

describe('random team distribution', () => {
  it('produces deterministic complete groups without mutating its input', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const result = distributePlayers(ids, 2, [0, 0, 0]);
    expect(result).toEqual([
      ['b', 'c'],
      ['d', 'a'],
    ]);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    expect([...result.flat()].sort()).toEqual(ids);
  });
  it.each([
    { ids: ['a', 'b', 'c'], size: 2, samples: [0, 0] },
    { ids: ['a', 'a'], size: 1, samples: [0] },
    { ids: ['a', 'b'], size: 0, samples: [0] },
    { ids: ['a', 'b'], size: 2, samples: [0] },
    { ids: ['a', 'b'], size: 1, samples: [1] },
    { ids: ['a', 'b'], size: 1, samples: [NaN] },
    { ids: ['', 'b'], size: 1, samples: [0] },
    { ids: ['a', 'b'], size: 1, samples: [] },
  ])('rejects incomplete, duplicate or invalid distributions', ({ ids, size, samples }) => {
    expect(() => distributePlayers(ids, size, samples)).toThrow();
  });
});
