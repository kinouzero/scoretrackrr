interface SemanticVersion {
  core: readonly bigint[];
  prerelease: readonly string[];
}
function parse(input: string): SemanticVersion | undefined {
  if (input.length > 128) return;
  const match =
    /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      input,
    );
  if (!match) return;
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) return;
  return { core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease };
}
/** SemVer precedence, allowing the conventional Git tag v prefix; metadata is ignored. */
export function compareReleaseVersions(left: string, right: string): -1 | 0 | 1 | null {
  const a = parse(left),
    b = parse(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a.core[i]! > b.core[i]!) return 1;
    if (a.core[i]! < b.core[i]!) return -1;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i],
      y = b.prerelease[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const numericX = /^\d+$/.test(x),
      numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
