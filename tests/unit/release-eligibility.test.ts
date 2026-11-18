import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = resolve('scripts/release-eligibility.mjs');
let cwd: string;
let commit: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
const run = (
  overrides: Partial<Record<'GITHUB_EVENT_NAME' | 'GITHUB_REF' | 'GITHUB_SHA', string>> = {},
) =>
  spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'push',
      GITHUB_REF: 'refs/tags/v1.2.3',
      GITHUB_SHA: commit,
      ...overrides,
    },
  });

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'scoretrackrr-release-'));
  git('init', '-b', 'master');
  git('config', 'user.name', 'Release fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  git('add', 'package.json');
  git('commit', '-m', 'Initial release fixture');
  commit = git('rev-parse', 'HEAD');
  git('update-ref', 'refs/remotes/origin/master', commit);
  git('tag', 'v1.2.3');
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

it('accepts a matching lightweight version tag on master', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Eligible release v1.2.3');
});

it('peels annotated tags to the checked-out commit', () => {
  git('tag', '-f', '-a', 'v1.2.3', '-m', 'Annotated fixture');
  expect(run().status).toBe(0);
  expect(run({ GITHUB_SHA: git('rev-parse', 'refs/tags/v1.2.3') }).status).toBe(0);
});

it('accepts an older release commit still contained in a newer master', () => {
  writeFileSync(join(cwd, 'later.txt'), 'Later master commit');
  git('add', 'later.txt');
  git('commit', '-m', 'Advance master');
  git('update-ref', 'refs/remotes/origin/master', git('rev-parse', 'HEAD'));
  git('checkout', '--detach', commit);
  expect(run().status).toBe(0);
});

it('rejects a version tag on an unmerged branch', () => {
  git('switch', '-c', 'unmerged');
  writeFileSync(join(cwd, 'feature.txt'), 'Unmerged commit');
  git('add', 'feature.txt');
  git('commit', '-m', 'Unmerged feature');
  commit = git('rev-parse', 'HEAD');
  git('tag', '-f', 'v1.2.3');
  expect(run().status).toBe(1);
});

it.each([
  { GITHUB_EVENT_NAME: 'workflow_dispatch' },
  { GITHUB_EVENT_NAME: 'pull_request' },
  { GITHUB_REF: 'refs/heads/master' },
  { GITHUB_REF: 'refs/tags/v01.2.3' },
  { GITHUB_REF: 'refs/tags/v1.2.3-rc.1' },
  { GITHUB_REF: 'refs/tags/v1.2.3+build' },
  { GITHUB_REF: 'refs/tags/v1.2' },
  { GITHUB_SHA: 'HEAD' },
])('rejects ineligible event/ref/SHA boundaries: %j', (event) => {
  expect(run(event).status).toBe(1);
});

it('fails closed when remote master is missing', () => {
  git('update-ref', '-d', 'refs/remotes/origin/master');
  expect(run().status).toBe(1);
});

it('rejects a tag that differs from package version', () => {
  git('tag', 'v1.2.4');
  const result = run({ GITHUB_REF: 'refs/tags/v1.2.4' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('package.json version');
});

it('rejects a different checked-out source or moved event tag', () => {
  writeFileSync(join(cwd, 'other.txt'), 'Different checked-out source');
  git('add', 'other.txt');
  git('commit', '-m', 'Other source');
  expect(run().status).toBe(1);
  git('tag', '-f', 'v1.2.3');
  expect(run().status).toBe(1);
});
