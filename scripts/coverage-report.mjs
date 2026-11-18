import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CoverageReport } from 'monocart-coverage-reports';
import astV8ToIstanbul from 'ast-v8-to-istanbul';
import { mergeScriptCovs } from '@bcoe/v8-coverage';
import { parseAstAsync } from 'vitest/node';
import { compile } from 'svelte/compiler';
import { coverageFailures } from './coverage-checks.mjs';

const root = resolve('src');
const sourcePath = (path) => {
  if (path.includes('node_modules')) return path;
  const match = path.replaceAll('\\', '/').match(/(?:^|\/)(src\/.*)$/);
  return match ? resolve(match[1]) : path;
};
const browser = new CoverageReport({
  name: 'Scoretrackrr browser coverage',
  outputDir: 'coverage/browser',
  reports: ['json', 'json-summary', 'console-summary'],
  sourcePath,
  cleanCache: true,
});

const files = (await readdir('coverage/browser-raw')).filter((name) => name.endsWith('.json'));
if (!files.length)
  throw new Error('Browser coverage is missing. Run the COVERAGE=1 browser suite.');
const scripts = new Map();
for (const file of files) {
  const entries = JSON.parse(await readFile(`coverage/browser-raw/${file}`, 'utf8'));
  for (const entry of entries) {
    const existing = scripts.get(entry.url);
    if (existing) {
      existing.functions = mergeScriptCovs([existing, entry]).functions;
    } else {
      scripts.set(entry.url, entry);
    }
  }
}
const coveredFiles = new Set();
async function addSource(code, map, url, functions) {
  map.sources = map.sources.map(sourcePath);
  const result = await astV8ToIstanbul({
    code,
    sourceMap: map,
    ast: await parseAstAsync(code),
    coverage: { url, functions },
  });
  const product = Object.fromEntries(
    Object.entries(result).filter(([file]) => file.startsWith(root + '/')),
  );
  for (const file of Object.keys(product)) coveredFiles.add(file);
  if (Object.keys(product).length) await browser.add(product);
}
for (const entry of scripts.values()) {
  const pathname = new URL(entry.url).pathname;
  let map;
  try {
    map = JSON.parse(await readFile(resolve(`.svelte-kit/output/client${pathname}.map`), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Bundler-only helpers have no product source map. Product files remain in the all-source denominator.
    continue;
  }
  await addSource(
    entry.source,
    map,
    pathToFileURL(resolve(`build${pathname}`)).href,
    entry.functions,
  );
}
async function includeUnvisitedComponents(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await includeUnvisitedComponents(file);
    else if (file.endsWith('.svelte') && !coveredFiles.has(file)) {
      const source = await readFile(file, 'utf8');
      const compiled = compile(source, { filename: file, generate: 'client' });
      compiled.js.map.sources = [file];
      await addSource(compiled.js.code, compiled.js.map, pathToFileURL(file).href, []);
    }
  }
}
await includeUnvisitedComponents(root);
await browser.generate();

const combined = new CoverageReport({
  name: 'Scoretrackrr source coverage',
  outputDir: 'coverage/combined',
  reports: ['html', 'json', 'json-summary', 'lcovonly', 'console-summary'],
  sourcePath,
  cleanCache: true,
});
await combined.add(JSON.parse(await readFile('coverage/unit/coverage-final.json', 'utf8')));
await combined.add(JSON.parse(await readFile('coverage/browser/coverage-final.json', 'utf8')));
await combined.generate();

const summary = JSON.parse(await readFile('coverage/combined/coverage-summary.json', 'utf8'));
const thresholds = JSON.parse(await readFile('coverage-thresholds.json', 'utf8'));
const failures = coverageFailures(summary.total, thresholds);
const coverage = JSON.parse(await readFile('coverage/combined/coverage-final.json', 'utf8'));
async function checkSourceInventory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) await checkSourceInventory(file);
    else if (/\.(?:ts|js|svelte)$/.test(file) && !file.endsWith('.d.ts') && !coverage[file])
      failures.push(`Source file missing from coverage: ${file}`);
  }
}
await checkSourceInventory(root);
if (failures.length) throw new Error(`Coverage gate failed:\n${failures.join('\n')}`);
