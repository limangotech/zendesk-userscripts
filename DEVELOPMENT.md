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
4. **chrome** — builds only to produce the store zip (check proved committed == fresh build), attaches it to the draft, then uploads it to the Chrome Web Store and submits it for publication (**unlisted**; goes live automatically once Google's review clears — usually minutes to hours, occasionally days).
5. **publish** — flips the draft to published once firefox succeeded: the atomic switchover of `releases/latest/download/…`. A failed chrome job never blocks the Firefox release; a failure in publish alone can simply be re-run.

Nothing is committed back to any branch — the feed lives entirely in release assets, so `main` can be branch-protected freely. A draft left behind by a failed run is reused on re-run; if you abandoned it (version bump + new tag), delete the stale draft by hand — users never see drafts either way.

### One-time setup (Firefox AMO)

1. With the company AMO account, create API credentials at [addons.mozilla.org → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) — and accept the **Firefox Add-on Distribution Agreement** when prompted (without it the API rejects submissions with a Forbidden error).
2. Add them as GitHub Actions repo secrets: `WEB_EXT_API_KEY` (the JWT issuer, `user:12345:67`) and `WEB_EXT_API_SECRET` (the JWT secret).

The very first tagged release *creates* the unlisted add-on on AMO under the gecko id — no manual pre-registration.

**⚠️ AMO burns version numbers.** Any version that completed an upload — even in a run that failed later — is rejected with HTTP 409 forever. A failure *before* upload (bad credentials, missing agreement) can be re-run for the same tag; a failure *after* the signing step needs a patch bump and a new tag. Never re-push a tag.

**⚠️ Never delete the add-on on AMO.** A deleted add-on's gecko ID is reserved *forever* — no account can ever submit that ID again ("Duplicate add-on ID found"), and the only way out is changing the ID in `extension/manifest.json` (which strands existing installs). Deleting is not a clean-up; it's a one-way door.

### One-time setup (Chrome Web Store)

All of this happens once, with the **shared company Google account** that owns the CWS publisher.

1. **Developer account** ([Developer Dashboard](https://chrome.google.com/webstore/devconsole)): one-time registration fee (USD 5) paid, contact email verified, 2-step verification enabled.
2. **OAuth credentials.** The CWS API only accepts requests authorized by the publisher account itself — the client id/secret merely identify our "app" and grant nothing on their own, and service accounts are not supported. The refresh token is the durable grant CI exchanges for short-lived access tokens on every release:
   1. [console.cloud.google.com](https://console.cloud.google.com), signed in as the shared account → create a project (e.g. `cws-publisher`, no billing required).
   2. APIs & Services → Library → enable the **Chrome Web Store API**.
   3. OAuth consent screen: user type **External**; fill only the app name, support email and developer contact. No logo, no extra scopes (a logo triggers Google's app-verification review).
   4. Click **Publish app** (publishing status "Testing" → "In production") and dismiss the verification prompt — the app stays "unverified", which is fine for own-account use. ⚠️ Skipping this breaks CI weekly: refresh tokens of Testing-status apps are revoked after 7 days.
   5. Credentials → Create credentials → OAuth client ID → **Desktop app** → note the client id and secret.
   6. Mint the refresh token: `npx chrome-webstore-upload-keys`
      1. enter the client id and secret from our registered [oauth client](https://console.cloud.google.com/auth/clients)
      2. open in the browser and log in as the shared account
      3. click through the "Google hasn't verified this app" warning (Advanced → continue — it's our own app) and grant the `chromewebstore` scope
      4. obtain the refresh token (lives until manually revoked or unused for ~6 months)
3. **The first upload is manual** — the API cannot create a new store item. Dashboard → **Add new item** → upload `dist/*.zip` (from `npm run build`) → fill the listing and privacy tabs from [store/chrome-web-store-listing.md](store/chrome-web-store-listing.md) → visibility **Unlisted** → submit for review. This mints the **extension ID** (shown on the item page); the **publisher ID** is in the dashboard URL (`…/devconsole/<publisher-id>`).
4. Add the five GitHub Actions repo secrets: `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`.
5. After the first publish, put the store URL into the README's Chrome section and wire the install badge to it.

**⚠️ CWS burns versions** An upload must carry a version strictly greater than the one already on record for the item — same discipline as AMO: a run that failed *after* the upload step needs a version bump and a new tag.

**Review delay.** Every CWS submission (any visibility) goes through Google's review. The workflow doesn't wait for it — publication happens automatically when review clears, so a release is "done" for Chrome agents somewhat later than for Firefox agents.

**If the refresh token is ever revoked** the chrome job fails with an auth error. Re-run step 2.6, update `CWS_REFRESH_TOKEN`, re-run the failed job: an auth failure happens before upload, so no version is burned.

**API version.** `chrome-webstore-upload-cli` is pinned to v4 in release.yml — it speaks the CWS API v2 (v1 shuts down on 15.10.2026). Don't downgrade below v4.

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
