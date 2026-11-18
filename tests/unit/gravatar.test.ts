import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGravatar, gravatarUrl } from '../../src/lib/application/gravatar';

afterEach(() => {
  vi.unstubAllGlobals();
});
describe('explicit Gravatar image retrieval', () => {
  it('uses the normalized SHA-256 identifier without sending the raw email in the URL', async () => {
    expect(await gravatarUrl('MyEmailAddress@example.com ')).toBe(
      'https://www.gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=128&d=404&r=g',
    );
  });
  it('returns cacheable image data and omits cookies and referrers', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchGravatar('a@example.com')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{64}\?/),
      expect.objectContaining({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it.each([
    new Response('', { status: 404 }),
    new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }),
    new Response('not a PNG', { headers: { 'content-type': 'image/png' } }),
    new Response(new Uint8Array(128 * 1024 + 1), { headers: { 'content-type': 'image/png' } }),
  ])('rejects missing, unsupported, malformed or oversized images', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(fetchGravatar('a@example.com')).rejects.toThrow();
  });
  it('propagates network failure so callers can save the profile with a local fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline')));
    await expect(fetchGravatar('a@example.com')).rejects.toThrow('Offline');
  });
});
