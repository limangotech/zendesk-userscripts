#!/usr/bin/env node
// Build the browser extension from the userscripts.
//
// The extension is an umbrella that bundles every feature userscript in the repo
// and the shared libraries they depend on. Each feature is a standalone `*.user.js`
// in userscripts/ (the single source of truth, installable on its own in Tampermonkey);
// this script turns the whole set into one MV3 extension:
//
//   1. Discover every feature: each `*.user.js` file in userscripts/.
//   2. For each, strip the ==UserScript== metadata and emit extension/features/<id>.js
//      (the IIFE body is portable verbatim — the extension injects it into the page's
//      MAIN world, exactly like the userscript's @grant none).
//   3. Resolve each feature's `@require` libraries to a committed file in
//      extension/vendor/ (MV3 forbids loading remote code, so the extension ships its
//      own copy — the userscript @require's the CDN instead). This is the single home
//      for vendored libs; the build only validates they are present, it does not copy.
//   4. Generate manifest.json's content_scripts: one entry per set of @match patterns,
//      listing the shared vendor files first (so they load once) then the feature
//      scripts, all in world:"MAIN". Files in a content script's `js` array run in
//      order and MAIN world shares the page's global scope, so a lib file publishes
//      e.g. window.DOMPurify for the feature file that follows it.
//   5. Zip extension/ into dist/ for the Chrome Web Store and Firefox AMO.
//
// Re-run this whenever a userscript changes: node scripts/build.mjs (or: npm run build)

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const userscriptsDir = join(root, 'userscripts')
const extDir = join(root, 'extension')
const featuresOutDir = join(extDir, 'features')
const vendorDir = join(extDir, 'vendor') // committed vendored libraries, shipped in the extension
const manifestPath = join(extDir, 'manifest.json')
const distDir = join(root, 'dist')

// Map an @require URL to the committed file in extension/vendor/ the extension loads for it.
// `test` is matched against the URL with any #integrity fragment removed. Keep the
// vendored copy in sync with the version pinned in each userscript's @require.
const VENDOR_MAP = [
  { id: 'dompurify', test: (u) => /\/dompurify@[\d.]+\/dist\/purify\.min\.js$/.test(u), file: 'purify.min.js' },
]

// --- Parse a userscript's metadata block ----------------------------------
const parseMeta = (src) => {
  const start = src.indexOf('// ==UserScript==')
  const end = src.indexOf('// ==/UserScript==')
  if (start === -1 || end === -1 || end < start) return null
  const meta = { name: null, matches: [], requires: [] }
  for (const line of src.slice(start, end).split('\n')) {
    const m = line.match(/^\/\/\s*@(\S+)\s+(.+?)\s*$/)
    if (!m) continue
    const [, key, val] = m
    if (key === 'name') meta.name = val
    else if (key === 'match') meta.matches.push(val)
    else if (key === 'require') meta.requires.push(val)
  }
  meta.bodyStart = src.indexOf('\n', end) + 1
  return meta
}

// Resolve one @require URL to a bundled vendor filename (or fail loudly).
const resolveVendor = (url, featureId) => {
  const bare = url.split('#')[0]
  const hit = VENDOR_MAP.find((v) => v.test(bare))
  if (!hit) {
    console.error(`Feature "${featureId}" @require's ${url}, which has no VENDOR_MAP entry.`)
    console.error('Add a mapping in scripts/build.mjs and commit the file to extension/vendor/ — the extension cannot fetch remote code.')
    process.exit(1)
  }
  if (!existsSync(join(vendorDir, hit.file))) {
    console.error(`VENDOR_MAP maps ${url} to extension/vendor/${hit.file}, but that file does not exist.`)
    process.exit(1)
  }
  return hit.file
}

// --- 1. Discover features -------------------------------------------------
// Every *.user.js in userscripts/ is a feature; its id is the filename sans .user.js.
if (!existsSync(userscriptsDir)) {
  console.error(`No userscripts/ directory found at ${userscriptsDir}.`)
  process.exit(1)
}
const features = readdirSync(userscriptsDir)
  .filter((f) => f.endsWith('.user.js'))
  .map((f) => ({ id: f.replace(/\.user\.js$/, ''), file: f, path: join(userscriptsDir, f) }))
if (features.length === 0) {
  console.error('No feature userscripts found (expected *.user.js files in userscripts/).')
  process.exit(1)
}
features.sort((a, b) => a.id.localeCompare(b.id)) // deterministic output

// --- 2. Clean previously generated output ---------------------------------
// Only features/ is generated; extension/vendor/ holds committed libraries — leave it.
rmSync(featuresOutDir, { recursive: true, force: true })
rmSync(join(extDir, 'content.js'), { force: true }) // obsolete single-feature artifact
mkdirSync(featuresOutDir, { recursive: true })

// --- 3. Emit each feature's script + collect its vendored libs ------------
const vendorFilesNeeded = new Set()
for (const f of features) {
  const src = readFileSync(f.path, 'utf8')
  const meta = parseMeta(src)
  if (!meta) {
    console.error(`Could not parse the ==UserScript== metadata block in ${f.path}.`)
    process.exit(1)
  }
  if (meta.matches.length === 0) {
    console.error(`Feature "${f.id}" has no @match patterns — cannot place it in a content script.`)
    process.exit(1)
  }
  f.matches = meta.matches
  f.vendorFiles = meta.requires.map((u) => resolveVendor(u, f.id))
  f.vendorFiles.forEach((v) => vendorFilesNeeded.add(v))

  const body = src.slice(meta.bodyStart).trimStart()
  const header = `// AUTO-GENERATED from userscripts/${f.file}
// Do not edit this file directly — edit the userscript and run: npm run build
//
// Injected into the page's MAIN world (see manifest.json "world": "MAIN") so it can
// read the page's CKEditor instance, just like the userscript's @grant none. Shared
// libraries (e.g. vendor/purify.min.js) are loaded by the manifest before this file.

`
  writeFileSync(join(featuresOutDir, `${f.id}.js`), header + body)
  console.log(`✓ features/${f.id}.js  (matches: ${f.matches.join(', ') || 'none'}, libs: ${f.vendorFiles.join(', ') || 'none'})`)
}

// --- 4. Report the vendored libraries in use (validated in resolveVendor) --
for (const file of [...vendorFilesNeeded].sort()) {
  console.log(`• vendor/${file} (bundled)`)
}

// --- 5. Generate content_scripts (grouped by identical @match set) --------
const groups = new Map()
for (const f of features) {
  const key = [...f.matches].sort().join('\n')
  if (!groups.has(key)) groups.set(key, { matches: f.matches, vendor: new Set(), scripts: [] })
  const g = groups.get(key)
  f.vendorFiles.forEach((v) => g.vendor.add(v))
  g.scripts.push(f.id)
}
const contentScripts = [...groups.values()].map((g) => ({
  matches: g.matches,
  js: [
    ...[...g.vendor].sort().map((v) => `vendor/${v}`),
    ...g.scripts.sort().map((id) => `features/${id}.js`),
  ],
  run_at: 'document_idle',
  world: 'MAIN',
}))

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.content_scripts = contentScripts
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`✓ manifest.json content_scripts (${contentScripts.length} entr${contentScripts.length === 1 ? 'y' : 'ies'})`)

// --- 6. Package the extension into dist/ ----------------------------------
const { version, name } = manifest
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const zipName = `${slug}-${version}.zip`

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir, { recursive: true })

try {
  // -r recurse, -X strip extra file attributes for a reproducible archive.
  // Zip from inside extension/ so manifest.json sits at the archive root
  // (required by both the Chrome Web Store and Firefox AMO).
  // Ship only the extension itself — leave maintainer docs out of the package.
  const entries = readdirSync(extDir).filter((e) => !e.endsWith('.md'))
  execFileSync('zip', ['-r', '-X', join(distDir, zipName), ...entries], { cwd: extDir, stdio: 'inherit' })
  console.log(`\n✓ packaged dist/${zipName}`)
  console.log('  Upload this to the Chrome Web Store and/or Firefox AMO.')
  console.log('  For a self-hosted Firefox .xpi, run: npm run sign:firefox')
} catch (e) {
  console.error('\nPackaging failed (is the `zip` command available?).', e.message)
  console.error('The extension/ directory itself is still loadable unpacked.')
  process.exit(1)
}
