import { compareReleaseVersions } from '#lib/domain/release-version';

export const releasesApiUrl = 'https://api.github.com/repos/kinouzero/scoretrackrr/releases';
export const RELEASE_CHECK_TIMEOUT = 8000;
const maximumResponseBytes = 1024 * 1024;
export type ReleaseCheckFailure =
  'offline' | 'rateLimited' | 'unavailable' | 'invalidResponse' | 'timeout' | 'cancelled';
export class ReleaseCheckError extends Error {
  constructor(readonly code: ReleaseCheckFailure) {
    super(code);
    this.name = 'ReleaseCheckError';
  }
}
export interface PublishedRelease {
  tag: string;
  url: string;
  publishedAt: string;
}
export type ReleaseCheckResult =
  | { status: 'none' }
  | { status: 'available' | 'current' | 'ahead' | 'unknown'; release: PublishedRelease };

async function readJson(response: Response): Promise<unknown> {
  const declaredSize = response.headers.get('content-length');
  if (declaredSize && Number(declaredSize) > maximumResponseBytes) {
    await response.body?.cancel();
    throw new ReleaseCheckError('invalidResponse');
  }
  if (
    !response.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new ReleaseCheckError('invalidResponse');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseBytes) {
        await reader.cancel();
        throw new ReleaseCheckError('invalidResponse');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ReleaseCheckError('invalidResponse');
  }
}
function release(input: unknown): PublishedRelease {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ReleaseCheckError('invalidResponse');
  const value = input as Record<string, unknown>;
  if (
    value.draft !== false ||
    value.prerelease !== false ||
    typeof value.tag_name !== 'string' ||
    value.tag_name.length < 1 ||
    value.tag_name.length > 128 ||
    /[\p{C}\s]/u.test(value.tag_name) ||
    typeof value.html_url !== 'string' ||
    value.html_url.length > 1024 ||
    typeof value.published_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value.published_at) ||
    !Number.isFinite(Date.parse(value.published_at))
  )
    throw new ReleaseCheckError('invalidResponse');
  try {
    const url = new URL(value.html_url);
    const prefix = '/kinouzero/scoretrackrr/releases/tag/';
    if (
      url.origin !== 'https://github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.startsWith(prefix) ||
      decodeURIComponent(url.pathname.slice(prefix.length)) !== value.tag_name
    )
      throw new Error('Unexpected release URL');
    return { tag: value.tag_name, url: url.href, publishedAt: value.published_at };
  } catch {
    throw new ReleaseCheckError('invalidResponse');
  }
}
function result(input: unknown, currentVersion: string): ReleaseCheckResult {
  const latest = release(input);
  const comparison = compareReleaseVersions(latest.tag, currentVersion);
  return {
    status:
      comparison === null
        ? 'unknown'
        : comparison > 0
          ? 'available'
          : comparison < 0
            ? 'ahead'
            : 'current',
    release: latest,
  };
}
/** Public metadata only, requested explicitly by Settings; never fetch or install release assets. */
export async function checkGithubRelease(
  currentVersion: string,
  signal?: AbortSignal,
): Promise<ReleaseCheckResult> {
  if (signal?.aborted) throw new ReleaseCheckError('cancelled');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  let timedOut = false;
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, RELEASE_CHECK_TIMEOUT);
  async function request(url: string) {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' ||
          response.headers.has('retry-after')))
    ) {
      await response.body?.cancel();
      throw new ReleaseCheckError('rateLimited');
    }
    if (!response.ok && response.status !== 404) {
      await response.body?.cancel();
      throw new ReleaseCheckError('unavailable');
    }
    return response;
  }
  try {
    const latest = await request(`${releasesApiUrl}/latest`);
    if (latest.status !== 404) return result(await readJson(latest), currentVersion);
    await latest.body?.cancel();
    // An accessible empty list distinguishes no stable release from an unavailable repository.
    const listing = await request(`${releasesApiUrl}?per_page=1`);
    if (listing.status === 404) {
      await listing.body?.cancel();
      throw new ReleaseCheckError('unavailable');
    }
    const list = await readJson(listing);
    if (!Array.isArray(list) || list.length > 1) throw new ReleaseCheckError('invalidResponse');
    if (!list.length) return { status: 'none' };
    const first = list[0];
    if (
      !first ||
      typeof first !== 'object' ||
      typeof first.draft !== 'boolean' ||
      typeof first.prerelease !== 'boolean'
    )
      throw new ReleaseCheckError('invalidResponse');
    if (first.draft || first.prerelease) return { status: 'none' };
    return result(first, currentVersion);
  } catch (failure) {
    if (timedOut) throw new ReleaseCheckError('timeout');
    if (signal?.aborted || controller.signal.aborted) throw new ReleaseCheckError('cancelled');
    if (failure instanceof ReleaseCheckError) throw failure;
    throw new ReleaseCheckError('unavailable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
