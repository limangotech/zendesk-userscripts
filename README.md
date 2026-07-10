# Zendesk Userscripts

A collection of browser userscripts for Zendesk agents at limango, extending Zendesk's functionality in combination with the Limango 360 sidebar app.

<p align="center">
  <a href="#chrome">
    <img src="assets/install-chrome.svg" alt="Install for Chrome — go to Chrome Web Store" width="380">
  </a>
  <a href="https://github.com/limangotech/zendesk-userscripts/releases/latest/download/zendesk-userscripts.xpi">
    <img src="assets/install-firefox.svg" alt="Install for Firefox — one-click install, auto-updates" width="380">
  </a>
</p>

---

## Installation

### Chrome
tbd — a Chrome Web Store (unlisted) listing is in preparation. Until then, use the [userscript manager](#userscript-manager) route below.

### Firefox
1. In Firefox, click this link: **[Install the extension (.xpi)](https://github.com/limangotech/zendesk-userscripts/releases/latest/download/zendesk-userscripts.xpi)**
2. Firefox asks for permission to install an add-on from this site — click **Continue to Installation** / **Allow**.
3. Click **Add** in the confirmation popup.
4. Reload any open Zendesk tabs — the extension runs automatically on `limango.zendesk.com` and the testing subdomains.

That's it. The extension is signed by Mozilla and **updates itself automatically** when we publish a new version — no need to reinstall.

### Other Browsers
#### Userscript Manager
1. Install a Userscript manager browser extension:
    - [Tampermonkey](https://www.tampermonkey.net/) for Chrome, Firefox, Edge or Safari (recommended)
    - [Violentmonkey](https://violentmonkey.github.io/) for Chrome, Firefox, or Edge
    - [Apple Userscripts](https://apps.apple.com/us/app/userscripts/id1463298887/) for Safari
2. Install the script:
    - [Side Conversation Replacement Script](https://github.com/limangotech/zendesk-userscripts/raw/refs/heads/main/side-conversation-replacement/side-conversation-replacement.user.js)
3. Click on Install
4. Reload any open Zendesk tabs — the script runs automatically on `limango.zendesk.com` and testing subdomains.

#### Manual Installation with Tampermonkey
1. ensure you have [Tampermonkey](https://www.tampermonkey.net/) installed.
2. Open the Tampermonkey dashboard by clicking its icon in the toolbar and selecting **Dashboard** (cogwheel).
3. Click the **+** tab to create a new script.
4. Delete the default template content.
5. Copy the full contents of the script you want to install and paste them into the editor:
    - [`side-conversation-replacement.user.js`](side-conversation-replacement/side-conversation-replacement.user.js)
6. Click **File → Save** (or `Ctrl+S` / `Cmd+S`).
7. Reload any open Zendesk tabs — the script runs automatically on `limango.zendesk.com` and testing subdomains.

> **Tip:** You can verify the script is running by opening the browser console on a Zendesk ticket page and looking for log lines prefixed with `[Limango Side Conversation Replacement Script]`.

---

## Deploying a new version

Releases are automated: pushing a version tag makes GitHub Actions sign the extension on Firefox AMO (unlisted) and create a GitHub Release carrying the signed `.xpi` plus the cumulative auto-update feed (`updates.json`). Installed copies pick the new version up automatically.

1. Make your changes in `userscripts/` (bump the changed userscript's own `@version` — userscripts are versioned independently).
2. `npm run bump` — bumps the extension's patch version in [extension/manifest.json](extension/manifest.json) and `package.json`, then rebuilds (`npm run bump --minor`, `--major`, or `npm run bump 1.2.3` for other bumps).
3. `npm run lint`, then commit (including the regenerated files).
4. Merge to `main`, then tag and push:
   ```bash
   git tag v<version>   # must match manifest.json, e.g. v0.3.0
   git push origin v<version>
   ```
5. Watch the **Release extension** workflow in the Actions tab. When it's green, the release exists and agents auto-update.

⚠️ Mozilla AMO never accepts the same version number twice — if a run fails after the signing step, bump the patch version and push a new tag instead of re-running. One-time setup (AMO API secrets), how the release pipeline and auto-update feed work, and the manual fallback: see [DEVELOPMENT.md](DEVELOPMENT.md).

---

## Available scripts
### Side Conversation Replacement Script

**File:** [`userscripts/side-conversation-replacement.user.js`](side-conversation-replacement/side-conversation-replacement.user.js)

Automatically replaces `[[limango.*]]` placeholders in the Zendesk side conversation composer (subject line and body) with live (order) data from the Limango 360 app currently open in the sidebar.

When an agent applies a macro containing placeholders, the script detects them, requests the resolved values from the Limango 360 iframe, and writes the result back into the composer — including proper handling of CKEditor's data pipeline for the body and React's controlled input for the subject field.

#### How it works

1. A MutationObserver watches for the side conversation composer to open.
2. On open (or when content changes), any text containing `[[limango.*]]` placeholders are sent to the Limango 360 sidebar app via `postMessage`.
3. The app resolves the placeholders using the currently viewed order's data and posts the result back.
4. The script writes the resolved text into the subject input and CKEditor body.
