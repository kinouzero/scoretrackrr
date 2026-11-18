# Contributing

Read the [architecture](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Architecture), [game contracts](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Scoring-Engine) and [data compatibility](https://github.com/kinouzero/scoretrackrr/wiki/Backups) before changing behavior. Keep public documentation current when a user flow, configuration or contract changes.

## Toolchain

Use Node 26.13.0 from `.node-version` and pnpm 12.21.0 from `package.json`. Install pnpm separately if it is not available, then run:

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm dev
```

For real offline behavior, use `pnpm build && pnpm preview`. The dev server does not provide production caching. The explicit development-only `/__dev/demo` route creates repeatable synthetic examples in that browser/origin; normal navigation never seeds data. Never use someone’s real browser storage for automated tests.

## Quality checks

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium webkit
pnpm test:e2e --workers=2
pnpm audit
```

`check` verifies documentation links, ICU parity, generated-validator parity, Svelte/TypeScript and service-worker types. `lint` runs ESLint and Prettier. Tests exercise pure scoring, fake IndexedDB transactions/migrations and the production static build in Chromium/WebKit. Python 3 serves browser fixtures and runs the optional Linux GranBoard relay. Do not rebuild while browser tests are running.

After changing trusted engine schemas, run `pnpm generate:engine`. Do not hand-edit generated validators or accept external runtime schemas/code. Keep focused tests for invalid input, state transitions, stale/concurrent commands, replay, compatibility and quota rollback. Do not add cosmetic tests that only lock exact markup/styles.

## Design and localization

- Keep game rules/reducers pure; ESLint rejects storage/framework/browser imports in the domain.
- Let repositories own IndexedDB writes and atomic transactions. Never write totals directly from UI controls.
- Preserve existing immutable definitions, old snapshots and backup readers when adding new rules.
- Reuse shared spacing/tokens, button/select patterns and the typed rounded-outline icon family.
- Keep controls keyboard-accessible with visible names/focus and44px touch targets.
- Add user-visible text to both ICU catalogs; see [translations](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Translations).
- Keep PWA detection separate from explicit activation; preserve running-game, transfer and other-window interlocks.

## Documentation screenshots

The favicon, header and install icons use the supplied blue scoreboard/trophy artwork. The provided PNG/ICO exports are preserved in `static/icons/`; the SVG sources are `icon.svg` (rounded), `icon-fullbleed.svg` (opaque Apple) and `icon-maskable.svg` (inset Android). After intentionally editing those sources, `pnpm generate:icons` with Playwright Chromium regenerates the PNG variants; text rendering can vary with installed fonts. It does not regenerate the supplied ICO or monochrome pinned-tab SVG. Keep the manifest's icon paths and theme colors aligned with the branding.

```sh
pnpm build
pnpm docs:screenshots
```

The script needs Playwright Chromium and Python 3, with local ports4178/4179 free. It starts its own development demo loader and production static server, uses isolated browser contexts, exports/restores synthetic data through the real JSON UI and captures17 views under `docs/images/`. A newly configured Yams match demonstrates current turn locking rather than a historical grid. Two real compiled-worker fixture versions demonstrate update readiness. No app data outside these contexts or deployed service is modified. The image manifest records capture provenance.

Run screenshot capture separately from browser tests; both use4178. Images live under `docs/`, outside `static/`, so they are not shipped or precached by the PWA.

## Delivery scope

The current app uses one device for everyone. Deferred peer transport/UI/diagnostics and old agent prompts are archived separately; historical peer data validators remain for backup integrity. Do not revive retired authoring/import/CSV/statistics/archive controls as a refactor side effect.

No hosted-CI, deployment or physical-phone result should be claimed from local browser emulation. Preserve unrelated changes and real data; do not publish, force-push or perform destructive cleanup without authorization.

Release maintainers should follow [version-tag publication](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Releases). The release workflow reuses quality checks and rejects tags outside remote `master` or inconsistent with the package version. Validate workflow edits with `actionlint .github/workflows/ci.yml`; the unit suite covers the Git eligibility gate without creating real releases.

## Benchmarks and gameplay fixtures

Run `pnpm bench` for optional preview/storage benchmarks and `pnpm bench:storage` for native Chromium IndexedDB measurements. See [performance](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Performance) for the reference workloads, limitations and test-fixture policy. Benchmarks stay outside the correctness suite and have no timing thresholds in CI. Preserve unit-file isolation and dedicated UI journeys when streamlining repeated gameplay prerequisites.

Original contributions use the repository's [MIT License](https://github.com/kinouzero/scoretrackrr/blob/master/LICENSE). Third-party dependencies, game names and external rulebooks retain their own rights.

## Documentation source

`docs/` is a Git submodule pointing to the public GitHub wiki. It has its own history and remote. Follow [wiki maintenance](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Wiki-Maintenance) when changing it, and initialize submodules before running documentation checks. The application user manual lives in the wiki; developer and release references are grouped in the separate Developer section of the same wiki.

## Source coverage

Run `pnpm coverage` after installing Playwright Chromium and WebKit. It runs unit coverage, a coverage build, both browser suites and a combined source report with enforced minimums. See [coverage maintenance](https://github.com/kinouzero/scoretrackrr/wiki/Developer-Coverage) for report paths and scope.
