import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkGithubRelease,
  releasesApiUrl,
  RELEASE_CHECK_TIMEOUT,
} from '../../src/lib/application/github-release';
import { compareReleaseVersions } from '../../src/lib/domain/release-version';
const published = (tag = 'v0.2.0') => ({
  tag_name: tag,
  html_url: `https://github.com/kinouzero/scoretrackrr/releases/tag/${tag}`,
  published_at: '2026-11-17T12:00:00Z',
  draft: false,
  prerelease: false,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('semantic release versions', () => {
  it.each([
    ['v1.2.3', '1.2.3+build.4', 0],
    ['1.10.0', '1.2.0', 1],
    ['0.1.0', '0.2.0', -1],
    ['1.0.0', '1.0.0-rc.1', 1],
    ['1.0.0-alpha.2', '1.0.0-alpha.10', -1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['99999999999999999999.0.0', '99999999999999999998.0.0', 1],
    ['release-2026', '1.0.0', null],
    ['01.0.0', '1.0.0', null],
    ['1.0.0-01', '1.0.0', null],
    ['1.2', '1.2.0', null],
    ['1.0.0', 'invalid', null],
    ['1'.repeat(129), '1.0.0', null],
  ])('compares %s with %s', (left, right, expected) => {
    expect(compareReleaseVersions(left, right)).toBe(expected);
  });
});
describe('public GitHub release checks', () => {
  it.each([
    ['v0.2.0', 'available'],
    ['v0.1.0', 'current'],
    ['v0.0.9', 'ahead'],
    ['release-2026', 'unknown'],
  ])('handles %s', async (tag, status) => {
    const fetcher = vi.fn().mockResolvedValue(json(published(tag)));
    vi.stubGlobal('fetch', fetcher);
    expect(await checkGithubRelease('0.1.0')).toMatchObject({ status, release: { tag } });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `${releasesApiUrl}/latest`,
      expect.objectContaining({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        cache: 'no-store',
      }),
    );
  });
  it('distinguishes no published release from an inaccessible repository', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', fetcher);
    expect(await checkGithubRelease('0.1.0')).toEqual({ status: 'none' });
    expect(fetcher.mock.calls[1]?.[0]).toBe(`${releasesApiUrl}?per_page=1`);
    fetcher.mockResolvedValue(json({}, 404));
    await expect(checkGithubRelease('0.1.0')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('ignores prereleases but handles a newly published stable release during the fallback', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json([{ ...published(), prerelease: true }]));
    vi.stubGlobal('fetch', fetcher);
    expect(await checkGithubRelease('0.1.0')).toEqual({ status: 'none' });
    fetcher.mockResolvedValueOnce(json({}, 404)).mockResolvedValueOnce(json([published()]));
    expect(await checkGithubRelease('0.1.0')).toMatchObject({ status: 'available' });
  });
  it.each([
    { html_url: 'https://example.com/evil' },
    { html_url: 'https://github.com/other/repo/releases/tag/v0.2.0' },
    { html_url: 'https://github.com/kinouzero/scoretrackrr/releases/tag/v0.3.0' },
    { html_url: 'javascript:alert(1)' },
    { tag_name: 'bad tag' },
    { published_at: 'invalid' },
    { draft: true },
    { prerelease: true },
  ])('rejects untrusted release metadata %j', async (override) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...published(), ...override })));
    await expect(checkGithubRelease('0.1.0')).rejects.toMatchObject({ code: 'invalidResponse' });
  });
  it.each([
    new Response('<html>error</html>'),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
    new Response('{}', {
      headers: { 'content-type': 'application/json', 'content-length': '1048577' },
    }),
  ])('rejects malformed or oversized responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(checkGithubRelease('0.1.0')).rejects.toMatchObject({ code: 'invalidResponse' });
  });
  it.each([
    [429, {}, 'rateLimited'],
    [403, { 'x-ratelimit-remaining': '0' }, 'rateLimited'],
    [403, { 'retry-after': '60' }, 'rateLimited'],
    [403, {}, 'unavailable'],
    [500, {}, 'unavailable'],
  ])('handles HTTP %i', async (status, headers, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status, headers })));
    await expect(checkGithubRelease('0.1.0')).rejects.toMatchObject({ code });
  });
  it('handles connection errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    await expect(checkGithubRelease('0.1.0')).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('times out and cancels requests', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      ),
    );
    const timeout = expect(checkGithubRelease('0.1.0')).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(RELEASE_CHECK_TIMEOUT);
    await timeout;
    const controller = new AbortController();
    const cancelled = expect(checkGithubRelease('0.1.0', controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    controller.abort();
    await cancelled;
    expect(vi.getTimerCount()).toBe(0);
  });
});
