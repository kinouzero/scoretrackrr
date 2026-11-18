import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function releaseEligibility({ cwd = process.cwd(), eventName, ref, sha }) {
  if (eventName !== 'push' || !ref?.startsWith('refs/tags/'))
    throw new Error('Publication requires a pushed version tag.');
  const tag = ref.slice('refs/tags/'.length);
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw new Error('Release tags must use the stable vMAJOR.MINOR.PATCH format.');
  if (!/^[a-f\d]{40}$|^[a-f\d]{64}$/.test(sha ?? ''))
    throw new Error('A full event commit SHA is required.');
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git('rev-parse', '--verify', `${ref}^{commit}`);
  if (
    commit !== git('rev-parse', '--verify', `${sha}^{commit}`) ||
    commit !== git('rev-parse', 'HEAD')
  )
    throw new Error('The tag, event commit and checked-out source must match.');
  // The workflow refreshes this exact remote ref immediately before calling the guard.
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/master');
  const version = tag.slice(1);
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
  if (pkg.version !== version) throw new Error('The tag must match package.json version.');
  return { tag, version, commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = releaseEligibility({
      eventName: process.env.GITHUB_EVENT_NAME,
      ref: process.env.GITHUB_REF,
      sha: process.env.GITHUB_SHA,
    });
    console.log(`Eligible release ${result.tag} (${result.commit}) on master.`);
  } catch (error) {
    console.error(`Release rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
