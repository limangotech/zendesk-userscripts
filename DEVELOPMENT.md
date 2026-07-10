# Developer guide

Everything for working on and releasing the extension. End-user install steps live in the [README](README.md#installation).

## How the repo fits together

- `userscripts/*.user.js` — the **source of truth**; each file is a standalone userscript.
- `scripts/build.mjs` — generates the browser extension from them: strips the userscript metadata into `extension/features/`, regenerates the `content_scripts` in `extension/manifest.json`, and zips `extension/` into `dist/`. Generated files are **committed** (so `extension/` stays loadable unpacked) — never edit them by hand; [ci.yml](.github/workflows/ci.yml) fails on every push/PR (and again at release time) if they don't match a fresh build.
- `extension/vendor/` — committed copies of the `@require`d libraries (MV3 forbids loading remote code).

```bash
npm ci               # once
npm run build        # regenerate extension/ + dist/ after editing a userscript
npm run lint         # web-ext lint --self-hosted (validates the manifest)
npm run dev:firefox  # throwaway Firefox with the extension loaded
npm run bump         # patch-bump the extension version + rebuild (--minor | --major | explicit: npm run bump 1.2.3)
```

## Releasing

Quick recipe: bump the userscript's `@version` and `version` in `extension/manifest.json`, `npm run build && npm run lint`, commit, merge to `main`, then push the tag `v<version>` (see the [README section](README.md#deploying-a-new-version)).

The tag triggers [.github/workflows/release.yml](.github/workflows/release.yml) — five jobs:

1. **prepare** — guards (tag matches the manifest version, version not already in the published feed — the feed is looked up on the newest *published* release that carries an `updates.json` asset, so manually created releases without one are skipped), then creates the GitHub Release as a **draft**. Drafts are invisible to `releases/latest`, so users keep getting the previous release until everything is ready. A leftover draft from a failed run is reused; an already-*published* release for the tag is a hard error.
2. **check** — the shared [ci.yml](.github/workflows/ci.yml) workflow (the same one every push/PR runs): build, committed-generated-files guard, lint. Runs in parallel with prepare.
3. **firefox** — signs the **committed** `extension/` on AMO (no rebuild — check proved it matches a fresh build; **unlisted** channel — Mozilla signs the `.xpi`, no public listing; automated, usually minutes, the job waits up to 1 h), merges the previous release's `updates.json`, and uploads to the draft: the versioned `.xpi` (immutable `update_link` target), a copy named `zendesk-userscripts.xpi` (stable `releases/latest/download/…` install link), and the merged feed.
4. **chrome** — placeholder (`if: false`) until the Chrome Web Store account and `CWS_*` secrets exist; builds only to produce the store zip, attaches it to the draft, then uploads to the store.
5. **publish** — flips the draft to published once firefox succeeded: the atomic switchover of `releases/latest/download/…`. A failed chrome job never blocks the Firefox release; a failure in publish alone can simply be re-run.

Nothing is committed back to any branch — the feed lives entirely in release assets, so `main` can be branch-protected freely. A draft left behind by a failed run is reused on re-run; if you abandoned it (version bump + new tag), delete the stale draft by hand — users never see drafts either way.

### One-time setup (Firefox AMO)

1. With the company AMO account, create API credentials at [addons.mozilla.org → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) — and accept the **Firefox Add-on Distribution Agreement** when prompted (without it the API rejects submissions with a Forbidden error).
2. Add them as GitHub Actions repo secrets: `WEB_EXT_API_KEY` (the JWT issuer, `user:12345:67`) and `WEB_EXT_API_SECRET` (the JWT secret).

The very first tagged release *creates* the unlisted add-on on AMO under the gecko id — no manual pre-registration.

**⚠️ AMO burns version numbers.** Any version that completed an upload — even in a run that failed later — is rejected with HTTP 409 forever. A failure *before* upload (bad credentials, missing agreement) can be re-run for the same tag; a failure *after* the signing step needs a patch bump and a new tag. Never re-push a tag.

**⚠️ Never delete the add-on on AMO.** A deleted add-on's gecko ID is reserved *forever* — no account can ever submit that ID again ("Duplicate add-on ID found"), and the only way out is changing the ID in `extension/manifest.json` (which strands existing installs). Deleting is not a clean-up; it's a one-way door.

### How Firefox auto-update works

`extension/manifest.json` points Firefox at the feed via `browser_specific_settings.gecko.update_url` = `https://github.com/limangotech/zendesk-userscripts/releases/latest/download/updates.json` — GitHub's stable URL for the `updates.json` asset of the **newest published release**. The feed is cumulative (every version ever released stays listed; each release also keeps the snapshot it shipped with); Firefox periodically installs the highest compatible entry:

```json
{
  "addons": {
    "zendesk-userscripts-v1@limango.com": {
      "updates": [
        {
          "version": "0.3.0",
          "update_link": "https://github.com/limangotech/zendesk-userscripts/releases/download/v0.3.0/zendesk-userscripts-v0.3.0.xpi",
          "update_hash": "sha256:…",
          "applications": { "gecko": { "strict_min_version": "142.0" } }
        }
      ]
    }
  }
}
```

[`scripts/release-update-manifest.mjs`](scripts/release-update-manifest.mjs) maintains the feed in CI — don't hand-edit release assets. Two caveats that follow from the `releases/latest` semantics:

- **Don't delete the newest release or mark releases as drafts/prereleases** — `releases/latest` skips those, so the feed and install link would fall back to an older release's assets.
- The `update_url` is baked into each signed `.xpi` — copies installed from builds *before* the current `update_url` existed won't auto-update and need a one-time reinstall from the release link.

Reference: Mozilla's [self-distribution guide](https://extensionworkshop.com/documentation/publish/self-distribution/) and [updating guide](https://extensionworkshop.com/documentation/manage/updating-your-extension/).

### Manual release (fallback)

If CI is unavailable, reproduce the workflow locally:

```bash
export WEB_EXT_API_KEY="user:...."
export WEB_EXT_API_SECRET="...."
npm run sign:firefox                                                  # signs unlisted → web-ext-artifacts/
gh release download --pattern updates.json --dir web-ext-artifacts   # previous feed (skip on the very first release)
mv web-ext-artifacts/*.xpi web-ext-artifacts/zendesk-userscripts-v<version>.xpi
cp web-ext-artifacts/zendesk-userscripts-v<version>.xpi web-ext-artifacts/zendesk-userscripts.xpi
node scripts/release-update-manifest.mjs web-ext-artifacts/zendesk-userscripts-v<version>.xpi
gh release create v<version> \
  web-ext-artifacts/updates.json \
  web-ext-artifacts/zendesk-userscripts.xpi \
  web-ext-artifacts/zendesk-userscripts-v<version>.xpi \
  --title v<version>
```

### Third-party libraries (AMO policy)

`extension/vendor/purify.min.js` is the unmodified `dist/purify.min.js` of the DOMPurify release pinned by the userscript's `@require` (currently **3.4.11**). Bundling a pre-minified third-party library does **not** trigger AMO's source-code-upload requirement (that applies to minified first-party code), but Mozilla's [third-party library policy](https://extensionworkshop.com/documentation/publish/third-party-library-usage/) expects version-pinned links if a reviewer asks: [release 3.4.11](https://github.com/cure53/DOMPurify/releases/tag/3.4.11), [readable source](https://github.com/cure53/DOMPurify/tree/3.4.11/src). Keep the vendored file, the `@require` pin, and this note in sync when upgrading.
