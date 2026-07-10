#!/usr/bin/env node
// Bump the extension version everywhere it lives, then rebuild.
//
//   npm run bump                 # patch: 0.2.1 -> 0.2.2
//   npm run bump --minor         # 0.2.1 -> 0.3.0
//   npm run bump --major         # 0.2.1 -> 1.0.0
//   npm run bump 1.2.3           # set an explicit version
//
// This bumps the EXTENSION version only:
//   - extension/manifest.json  `version`   (source the release workflow checks the tag against)
//   - package.json + lockfile  `version`   (via `npm version`, cosmetic but tidy)
//
// Userscripts are deliberately untouched — each *.user.js is a standalone
// feature with its own independent @version; bump those by hand when the
// script itself changes.
//
// Afterwards scripts/build.mjs runs so the regenerated extension/ + dist/ match.
// No git operations happen here — commit, merge to main, then tag v<version>
// to trigger .github/workflows/release.yml (see DEVELOPMENT.md).

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'extension', 'manifest.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const current = manifest.version

// --- Work out the target version ------------------------------------------
// npm swallows `--major`-style flags (they never reach argv) and exposes them
// as npm_config_* env vars instead — accept both that and positional args.
const flag = ['major', 'minor', 'patch'].find((k) => process.env[`npm_config_${k}`] === 'true')
const arg = process.argv[2] ?? flag ?? 'patch'
let next
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg
} else if (['patch', 'minor', 'major'].includes(arg)) {
  const [major, minor, patch] = current.split('.').map(Number)
  next =
    arg === 'major' ? `${major + 1}.0.0` :
    arg === 'minor' ? `${major}.${minor + 1}.0` :
    `${major}.${minor}.${patch + 1}`
} else {
  console.error(`Unknown argument "${arg}" — expected patch, minor, major, or an explicit x.y.z`)
  process.exit(1)
}
if (next === current) {
  console.log(`✓ version is already ${current} — nothing to do`)
  process.exit(0)
}

// --- 1. extension/manifest.json --------------------------------------------
manifest.version = next
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`✓ extension/manifest.json  ${current} → ${next}`)

// --- 2. package.json + package-lock.json -----------------------------------
execFileSync('npm', ['version', next, '--no-git-tag-version', '--allow-same-version'], {
  cwd: root,
  stdio: 'ignore',
})
console.log(`✓ package.json + package-lock.json → ${next}`)

// --- 3. rebuild so extension/ + dist/ match the new version -----------------
execFileSync('node', [join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' })

console.log(`\n✓ bumped ${current} → ${next}`)
console.log('  Next: commit, merge to main, then trigger the release:')
console.log(`  git tag v${next} && git push origin v${next}`)
