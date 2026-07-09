#!/usr/bin/env node
// Add the current extension version to the Firefox self-hosting update feed.
//
// Firefox installs of the self-hosted (AMO-unlisted) extension poll the manifest's
// gecko update_url — the updates.json asset of the LATEST GitHub Release, served at
// the stable URL .../releases/latest/download/updates.json — and update themselves
// to the highest version listed there. The feed is cumulative: the release workflow
// downloads the previous release's updates.json into web-ext-artifacts/, this script
// appends the entry for the version being released, and the workflow attaches the
// result to the new release:
//
//   node scripts/release-update-manifest.mjs web-ext-artifacts/<asset>.xpi
//
// It reads the version + gecko id from extension/manifest.json, hashes the signed
// .xpi (update_hash lets Firefox verify the download), and points update_link at the
// GitHub Release asset for that version's tag. If web-ext-artifacts/updates.json
// does not exist (first release), a fresh feed is started. Idempotent: re-running
// for an already listed version is a no-op, so a re-run doesn't duplicate entries.
//
// Run by the firefox job of .github/workflows/release.yml after signing; runnable locally too.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const extensionManifestPath = join(root, 'extension', 'manifest.json')
const feedPath = join(root, 'web-ext-artifacts', 'updates.json')

const REPO_URL = 'https://github.com/limangotech/zendesk-userscripts'
// Release asset naming convention — must match the rename step in the release
// workflow, which names the asset after the tag (v<version>).
const assetName = (version) => `zendesk-userscripts-v${version}.xpi`

const xpiPath = process.argv[2]
if (!xpiPath) {
  console.error('Usage: node scripts/release-update-manifest.mjs <path-to-signed.xpi>')
  process.exit(1)
}
if (!existsSync(xpiPath)) {
  console.error(`Signed xpi not found: ${xpiPath}`)
  process.exit(1)
}

const extManifest = JSON.parse(readFileSync(extensionManifestPath, 'utf8'))
const { version } = extManifest
const gecko = extManifest.browser_specific_settings?.gecko
if (!gecko?.id) {
  console.error('extension/manifest.json has no browser_specific_settings.gecko.id')
  process.exit(1)
}

// The update_link must point at the asset we are hashing — fail loudly if the
// workflow's rename step and this script's naming convention ever drift apart.
if (basename(xpiPath) !== assetName(version)) {
  console.error(`Expected the signed xpi to be named ${assetName(version)}, got ${basename(xpiPath)}.`)
  console.error('Rename it first (the release workflow does) so update_link matches the uploaded asset.')
  process.exit(1)
}

let feed
if (existsSync(feedPath)) {
  feed = JSON.parse(readFileSync(feedPath, 'utf8'))
  if (!feed.addons?.[gecko.id]) {
    // The gecko id is the extension's identity — a feed without it means the id
    // changed, which would strand every existing install. Never paper over that.
    console.error(`${feedPath} has no entry for addon id "${gecko.id}" (found: ${Object.keys(feed.addons ?? {}).join(', ') || 'none'}).`)
    process.exit(1)
  }
  console.log(`• continuing the feed from the previous release (${feed.addons[gecko.id].updates.length} version(s) listed)`)
} else {
  feed = { addons: { [gecko.id]: { updates: [] } } }
  console.log('• no previous feed found — starting a fresh one (first release)')
}
const addon = feed.addons[gecko.id]

if (addon.updates.some((u) => u.version === version)) {
  console.log(`✓ version ${version} already listed in the feed — nothing to do`)
  process.exit(0)
}

const entry = {
  version,
  update_link: `${REPO_URL}/releases/download/v${version}/${assetName(version)}`,
  update_hash: `sha256:${createHash('sha256').update(readFileSync(xpiPath)).digest('hex')}`,
}
// Firefox only updates to versions it can run — carry the manifest's floor over.
if (gecko.strict_min_version) {
  entry.applications = { gecko: { strict_min_version: gecko.strict_min_version } }
}

addon.updates.push(entry)
writeFileSync(feedPath, JSON.stringify(feed, null, 2) + '\n')
console.log(`✓ added version ${version} to web-ext-artifacts/updates.json`)
console.log(`  ${entry.update_link}`)
