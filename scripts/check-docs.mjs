import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
const root = process.cwd();
async function markdown(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) result.push(...(await markdown(path)));
    else if (item.name.endsWith('.md')) result.push(path);
  }
  return result;
}
const files = [
  resolve('README.md'),
  resolve('CONTRIBUTING.md'),
  ...(await markdown(resolve('docs'))),
];
const failures = [];
let links = 0;
for (const file of files) {
  const content = await readFile(file, 'utf8');
  if (/\/Users\/|\/private\/tmp\/|plugin:\/\//.test(content))
    failures.push(`${relative(root, file)}: private workspace path in public documentation`);
  for (const match of content.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const url = match[1];
    if (!url) continue;
    const wiki = 'https://github.com/kinouzero/scoretrackrr/wiki/';
    const wikiAssets = 'https://raw.githubusercontent.com/wiki/kinouzero/scoretrackrr/';
    let target;
    if (url.startsWith(wiki))
      target = resolve('docs', `${decodeURIComponent(url.slice(wiki.length).split('#')[0])}.md`);
    else if (url.startsWith(wikiAssets))
      target = resolve('docs', decodeURIComponent(url.slice(wikiAssets.length)));
    else {
      if (/^(?:https?:|mailto:|#)/.test(url)) continue;
      target = resolve(dirname(file), decodeURIComponent(url.split('#')[0]));
    }
    if (relative(root, target).startsWith('..')) {
      failures.push(`${relative(root, file)}: link leaves repository: ${url}`);
      continue;
    }
    links++;
    try {
      await access(target);
    } catch {
      failures.push(`${relative(root, file)}: missing target ${url}`);
    }
  }
}
const manifest = JSON.parse(await readFile('docs/images/manifest.json', 'utf8'));
for (const image of manifest.images) {
  const bytes = await readFile(resolve('docs/images', image.file));
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    failures.push(`Invalid PNG: ${image.file}`);
}
await access('.node-version');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Validated ${links} local links in ${files.length} documents and ${manifest.images.length} screenshot files.`,
  );
