#!/usr/bin/env node
// Builds dist/: unbundled ESM + declarations + source maps (tsc) and the CSS
// file. Unbundled output keeps per-module `"use client"` directives and lets
// consumer bundlers split the lazily imported Shaka/IMA/Cast paths.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.build.json')], { stdio: 'inherit' });
fs.copyFileSync(path.join(root, 'src/styles.css'), path.join(dist, 'styles.css'));

// Sanity checks on the emitted artifact.
const mustStartWithUseClient = ['index.js', 'react/Player.js', 'react/PlayerErrorBoundary.js'];
for (const file of mustStartWithUseClient) {
  const text = fs.readFileSync(path.join(dist, file), 'utf8');
  if (!/^['"]use client['"];/.test(text)) throw new Error(`${file} lost its "use client" directive`);
}
const coreText = fs.readFileSync(path.join(dist, 'core.js'), 'utf8');
if (/use client/.test(coreText.split('\n')[0] ?? '')) throw new Error('core.js must not be a client boundary');
for (const file of ['index.d.ts', 'core.d.ts', 'styles.css']) {
  if (!fs.existsSync(path.join(dist, file))) throw new Error(`missing dist/${file}`);
}
console.log('[build] dist ready');
