import { describe, expect, it } from 'vitest';
import { gameSettings, versionForSetting } from '../../src/lib/application/game-settings';
import { yamsVersion } from '../../src/lib/domain/games/yams';
import { farkleVersion } from '../../src/lib/domain/games/farkle';
import { x01Version } from '../../src/lib/domain/games/darts';
import { cricketVersion } from '../../src/lib/domain/games/cricket';
import { molkkyVersion } from '../../src/lib/domain/games/molkky';

const yams = [true, false].map((value) => yamsVersion(value, ''));
const farkle = ([5000, 10000] as const).flatMap((target) =>
  ([0, 500] as const).map((entry) => farkleVersion(target, entry, '')),
);
const darts = [
  ...([301, 501] as const).flatMap((start) =>
    [true, false].map((double) => x01Version(start, double, '')),
  ),
  ...[true, false].map((points) => cricketVersion(points, '')),
];
describe('setup settings select immutable game rules', () => {
  it.each([false, true])('selects the Yams upper bonus %s', (enabled) => {
    const version = versionForSetting(yams[0]!, yams, 'upperBonus', enabled);
    expect(version?.id).toBe(yamsVersion(enabled, '').id);
    expect(gameSettings(version!)).toEqual([{ key: 'upperBonus', enabled }]);
  });
  it.each(farkle)('keeps other Farkle parameters for $id', (current) => {
    const before = structuredClone(current);
    for (const enabled of [true, false]) {
      expect(versionForSetting(current, farkle, 'target10000', enabled)?.definition).toMatchObject({
        target: enabled ? 10000 : 5000,
        entry: current.definition.entry,
      });
      expect(versionForSetting(current, farkle, 'entry500', enabled)?.definition).toMatchObject({
        target: current.definition.target,
        entry: enabled ? 500 : 0,
      });
    }
    expect(current).toEqual(before);
  });
  it.each(darts.filter((version) => version.definition.engine === 'x01'))(
    'keeps independent X01 settings for $id',
    (current) => {
      for (const enabled of [true, false]) {
        expect(versionForSetting(current, darts, 'doubleOut', enabled)?.definition).toMatchObject({
          start: current.definition.start,
          doubleOut: enabled,
        });
      }
      expect(gameSettings(current).map(({ key }) => key)).toEqual(['doubleOut']);
      expect(versionForSetting(current, darts, 'cricketPoints', true)).toBeUndefined();
    },
  );
  it.each(darts.filter((version) => version.definition.engine === 'cricket'))(
    'selects only Cricket scoring for $id',
    (current) => {
      for (const enabled of [true, false])
        expect(versionForSetting(current, darts, 'cricketPoints', enabled)?.id).toBe(
          cricketVersion(enabled, '').id,
        );
      expect(gameSettings(current).map(({ key }) => key)).toEqual(['cricketPoints']);
      expect(versionForSetting(current, darts, 'doubleOut', false)).toBeUndefined();
    },
  );
  it('never creates unsupported switches for fixed rules or custom definitions', () => {
    expect(gameSettings(molkkyVersion(''))).toEqual([]);
    expect(gameSettings({ ...yams[0]!, gameId: 'custom-test' })).toEqual([]);
    expect(versionForSetting(molkkyVersion(''), darts, 'cricketPoints', true)).toBeUndefined();
  });
  it('rejects unavailable combinations, cross-family matches and unsupported settings', () => {
    const current = x01Version(301, true, '');
    expect(versionForSetting(current, [current], 'doubleOut', false)).toBeUndefined();
    expect(
      versionForSetting(
        current,
        [{ ...x01Version(301, false, ''), gameId: 'custom-test' }],
        'doubleOut',
        false,
      ),
    ).toBeUndefined();
    expect(versionForSetting(current, darts, 'entry500', true)).toBeUndefined();
  });
});
