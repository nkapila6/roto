#!/usr/bin/env node
// Asset integrity for roto. Plates are the reproducible
// baseline of the project - if they drift, every later comparison is
// meaningless, so pin them and fail loudly.
//
//   node scripts/hashes.mjs make    [--include a b c]   write assets-manifest.json
//   node scripts/hashes.mjs check                       verify files and fonts
//   node scripts/hashes.mjs fonts --accept-font-license download declared fonts
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const manifestPath = path.join(root, 'assets-manifest.json');
const DEFAULT_INCLUDE = ['index.html', 'film.js', 'assets/tracks.js', 'assets/plates', 'assets'];

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

// Manifest keys are relative paths from an untrusted file; resolve and confine
// them before reading anything.
function safe(relative) {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`asset path escapes the project: ${relative}`);
  }
  return resolved;
}

function walk(target, skip) {
  const resolved = safe(target);
  if (!fs.existsSync(resolved)) return [];
  if (fs.statSync(resolved).isFile()) return [path.relative(root, resolved)];
  return fs.readdirSync(resolved).flatMap(entry => {
    const next = path.join(path.relative(root, resolved), entry);
    return skip.has(path.posix.normalize(next)) ? [] : walk(next, skip);
  });
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error('no assets-manifest.json. Run: node scripts/hashes.mjs make');
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function make(args) {
  const flag = args.indexOf('--include');
  const include = flag === -1 ? DEFAULT_INCLUDE : args.slice(flag + 1).filter(a => !a.startsWith('--'));
  const previous = fs.existsSync(manifestPath) ? readManifest() : {};
  // Fonts are declared, never discovered: they are downloaded at setup time and
  // deliberately not committed, so a walk would miss them on a clean checkout.
  const fonts = previous.fonts ?? {};
  const skip = new Set(Object.keys(fonts).map(p => path.posix.normalize(p)));
  const files = {};
  for (const relative of include.flatMap(entry => walk(entry, skip)).sort()) {
    if (relative in files) continue;
    files[relative] = sha256(fs.readFileSync(safe(relative)));
  }
  fs.writeFileSync(manifestPath, JSON.stringify({include, files, fonts}, null, 2) + '\n');
  console.log(`pinned ${Object.keys(files).length} files and ${Object.keys(fonts).length} fonts`);
}

function check() {
  const manifest = readManifest();
  for (const [relative, expected] of Object.entries(manifest.files ?? {})) {
    const resolved = safe(relative);
    if (!fs.existsSync(resolved)) throw new Error(`missing asset: ${relative}`);
    if (sha256(fs.readFileSync(resolved)) !== expected) {
      throw new Error(`asset hash mismatch: ${relative}\n` +
        'Regenerated plates or an edited asset. Rebuild deliberately and re-run `make`, ' +
        'or restore the committed baseline.');
    }
  }
  for (const [relative, font] of Object.entries(manifest.fonts ?? {})) {
    const resolved = safe(relative);
    if (!fs.existsSync(resolved)) {
      throw new Error(`missing font ${relative}. Read ${font.license} then run: ` +
        'node scripts/hashes.mjs fonts --accept-font-license');
    }
    if (sha256(fs.readFileSync(resolved)) !== font.sha256) {
      throw new Error(`font hash mismatch: ${relative}. Refusing a silent font substitution - ` +
        'a different font changes every glyph in the render.');
    }
  }
  console.log(`verified ${Object.keys(manifest.files ?? {}).length} files and ` +
    `${Object.keys(manifest.fonts ?? {}).length} fonts`);
}

async function fonts(args) {
  const manifest = readManifest();
  const entries = Object.entries(manifest.fonts ?? {});
  if (!entries.length) return console.log('no fonts declared');
  for (const [relative, font] of entries) {
    const resolved = safe(relative);
    if (fs.existsSync(resolved) && sha256(fs.readFileSync(resolved)) === font.sha256) {
      console.log(`${relative}: verified`);
      continue;
    }
    if (!args.includes('--accept-font-license')) {
      throw new Error(`${relative} is licensed, not redistributed. Read ${font.license}, ` +
        'then re-run with --accept-font-license. Or download it yourself and place it there.');
    }
    const response = await fetch(font.source, {signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error(`font download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== font.sha256) {
      throw new Error(`${relative}: upstream bytes changed. Refusing a silent substitution.`);
    }
    fs.mkdirSync(path.dirname(resolved), {recursive: true});
    fs.writeFileSync(resolved, bytes);
    console.log(`${relative}: downloaded and verified`);
  }
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'make') make(args);
  else if (command === 'check') check();
  else if (command === 'fonts') await fonts(args);
  else {
    console.error('usage: hashes.mjs make|check|fonts');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
