const maxImageBytes = 128 * 1024;

export async function gravatarUrl(email: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `https://www.gravatar.com/avatar/${hash}?s=128&d=404&r=g`;
}

// Fetch only from an explicit profile action; cached data URLs render offline.
export async function fetchGravatar(email: string): Promise<string> {
  const response = await fetch(await gravatarUrl(email), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const type = response.headers.get('content-type')?.split(';')[0];
  if (
    !response.ok ||
    !type ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(type) ||
    !response.body
  )
    throw new Error('GRAVATAR_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxImageBytes) {
        await reader.cancel();
        throw new Error('GRAVATAR_TOO_LARGE');
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
  const signature =
    type === 'image/png'
      ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
      : type === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
          new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
  if (!signature) throw new Error('GRAVATAR_INVALID_IMAGE');
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return `data:${type};base64,${btoa(binary)}`;
}
