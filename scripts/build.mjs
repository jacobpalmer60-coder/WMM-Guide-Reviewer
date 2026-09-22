#!/usr/bin/env node
// Reads data/reviews.json and injects it into site/template.html to produce site/index.html.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const dataPath = process.argv[2] || path.join(ROOT, 'data/reviews.json');
  const templatePath = path.join(ROOT, 'site/template.html');
  const outPath = path.join(ROOT, 'site/index.html');

  const [data, template] = await Promise.all([
    readFile(dataPath, 'utf8'),
    readFile(templatePath, 'utf8'),
  ]);

  JSON.parse(data); // fail fast if data/reviews.json is malformed

  const html = template.replace('/*__REVIEWS_DATA__*/null', data);
  await writeFile(outPath, html, 'utf8');
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
