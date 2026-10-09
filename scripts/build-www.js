#!/usr/bin/env node
/* Stage the static web app into www/ for Capacitor.
   The repo root is the web app (so GitHub Pages can serve it as-is);
   Capacitor wants a dedicated webDir, so we copy only the app files here. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');
const entries = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'css',
  'js',
  'icons',
  'fonts'
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of entries) {
  const src = path.join(root, entry);
  if (!fs.existsSync(src)) {
    console.warn(`build-www: skipping missing ${entry}`);
    continue;
  }
  fs.cpSync(src, path.join(out, entry), { recursive: true });
}
console.log(`build-www: staged ${entries.length} entries into www/`);
