import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const run = (args, coverage = false) =>
  execFileSync('pnpm', args, {
    stdio: 'inherit',
    env: { ...process.env, ...(coverage ? { COVERAGE: '1' } : {}) },
  });

for (const directory of ['coverage/browser-raw', 'coverage/browser', 'coverage/combined'])
  rmSync(directory, { recursive: true, force: true });
run(['test:coverage', '--maxWorkers=4']);
run(['build'], true);
run(['test:e2e', '--workers=2', '--max-failures=1'], true);
run(['coverage:report']);
