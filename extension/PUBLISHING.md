# Building & publishing the extension

This is the maintainer guide for the `extension/` package. End-user install steps live in the [top-level README](../README.md).

## What's in here

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. **Generated** `content_scripts`, hand-managed everything else. One file for both browsers — Chrome ignores the `browser_specific_settings` block; Firefox uses it. |
| `features/<feature>.js` | **Generated**, one per userscript (metadata stripped). Don't edit by hand — edit the source `.user.js` and rebuild. |
| `vendor/*.js` | **Committed** shared libraries (e.g. `purify.min.js`) the features `@require` — the single home for vendored libs. Not generated; the build validates they're present and wires them into the manifest. |
| `icons/` | Generated PNG icons (16/32/48/128). |

The content scripts are injected into the page's **MAIN world** (`"world": "MAIN"`). That is the whole reason this works as a native extension: a feature script reads the page's live CKEditor instance (`el.ckeditorInstance`) and calls its API. A default (isolated) content script cannot see page-set JS properties. Files in a content-script entry's `js` array run in order and MAIN-world scripts share the page's global scope, so a `vendor/` library file publishes its global (e.g. `window.DOMPurify`) for the feature file listed after it. `world: "MAIN"` needs **Chrome 111+** and **Firefox 140+** (140 is also where the required `data_collection_permissions` key is understood — hence `strict_min_version: "140.0"`).

## Build

```bash
npm install          # one-time, installs web-ext
npm run build        # regenerates features/ + manifest content_scripts, then zips to dist/
```

`npm run build` produces `dist/limango-zendesk-side-conversation-replacement-<version>.zip` — the upload artifact for **both** the Chrome Web Store and Firefox AMO.

```bash
npm run lint         # web-ext lint (validates the manifest)
npm run dev:firefox  # launch a throwaway Firefox with the extension loaded
```

To bump the version, edit `version` in `manifest.json` (and ideally the `@version` in the userscript), then rebuild.

---

## Do you even need to publish to a store?

**No.** Pick based on who installs it and whether IT manages the browsers:

| Audience | Chrome / Edge | Firefox |
| --- | --- | --- |
| A handful of technical agents, manual updates OK | **Load unpacked** from the repo (free, instant) | **Temporary add-on** (dev only) or a self-hosted signed `.xpi` |
| Non-technical agents, want one-click + auto-update | **Chrome Web Store** (unlisted or Workspace-private) | **AMO** (listed) or self-hosted signed `.xpi` |
| Browsers managed by IT (MDM / Group Policy / Google Admin) | **Enterprise force-install** from a self-hosted `.crx` | **Enterprise policy** force-install from a self-hosted `.xpi` |

**Recommendation for our internal, fixed set of agents:** the lowest-friction durable setup is **Chrome Web Store (unlisted)** + a **self-hosted signed `.xpi` for Firefox** hosted on a GitHub Release. Both give one-click install and auto-updates without a public listing. If IT already manages our browsers, prefer **enterprise force-install** — it's silent and centrally controlled.

> Creating a Chrome developer account ($5 one-time fee) and a Mozilla AMO account are **company/IT decisions** — these accounts should be owned by limango, not a personal account. Flag this with whoever owns browser tooling before publishing.

---

## Chrome / Edge

### Chrome Web Store

1. Register once at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time **$5** fee, company account).
2. **New item** → upload `dist/…zip`.
3. Set **Visibility**:
   - **Unlisted** — anyone with the link can install; not searchable. Good for internal tools.
   - **Private** — restricted to members of your Google Workspace org (if limango uses Workspace). Tightest scope.
   - **Public** — listed and searchable. Not needed here.
4. Submit for review. Even unlisted/private items are reviewed; turnaround is usually hours to a few days.
5. Share the install link. Updates: upload a new zip with a higher `version`; Chrome auto-updates installed copies.

Edge has its own [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge) store with the same zip, but Edge also installs Chrome Web Store extensions, so a separate Edge listing usually isn't worth it.

### Enterprise force-install (no store)

If IT manages Chrome (Google Admin console, Windows Group Policy, Intune, Jamf):

1. Pack/sign a `.crx` and host it plus an `updates.xml` (Omaha format) on a server or GitHub Release.
2. Set the `ExtensionInstallForcelist` policy to `<extension-id>;https://…/updates.xml`.

`updates.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="YOUR_EXTENSION_ID">
    <updatecheck codebase="https://github.com/limangotech/zendesk-userscripts/releases/download/v0.1.0/extension.crx" version="0.1.0" />
  </app>
</gupdate>
```

Chrome installs it silently and keeps it updated. See the [Chrome enterprise hosting docs](https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux).

### What does *not* work on Chrome

You **cannot** install a `.crx` by downloading it from a GitHub page and double-clicking it. Chrome blocks extensions that don't come from the Web Store or an enterprise policy. So a "click to install from GitHub" flow is **not possible for Chrome** for normal users — use the Web Store or enterprise policy instead. (Load-unpacked from a cloned repo is the only no-store, no-policy path.)

---

## Firefox

Firefox **requires every installed extension to be signed by Mozilla**, including self-hosted ones. Signing is free and automated.

### Self-hosted signed `.xpi` — the "install from GitHub" path

This is the install-direct-from-GitHub flow Firefox *does* support:

1. Create AMO API credentials at [addons.mozilla.org → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) (company account). Export them:
   ```bash
   export WEB_EXT_API_KEY="user:...."
   export WEB_EXT_API_SECRET="...."
   ```
2. Sign as an **unlisted** add-on:
   ```bash
   npm run sign:firefox
   ```
   This submits to AMO for an automated review and downloads a **signed `.xpi`** into `web-ext-artifacts/`.
3. Attach the `.xpi` to a **GitHub Release**.
4. Agents open the release `.xpi` link in Firefox → it installs. (Firefox installs signed `.xpi` files from anywhere.)

**Auto-updates** for self-hosted xpis: add an `update_url` to the manifest pointing at an `updates.json` you also host (e.g. in the repo or a release), then list each new signed build there:

`manifest.json` (gecko block):
```json
"update_url": "https://raw.githubusercontent.com/limangotech/zendesk-userscripts/main/extension/updates.json"
```

`updates.json`:
```json
{
  "addons": {
    "zendesk-side-conversation-replacement@limango.com": {
      "updates": [
        {
          "version": "0.1.0",
          "update_link": "https://github.com/limangotech/zendesk-userscripts/releases/download/v0.1.0/zendesk_side_conversation_replacement-0.1.0.xpi"
        }
      ]
    }
  }
}
```

See [Mozilla's self-distribution guide](https://extensionworkshop.com/documentation/publish/self-distribution/).

### AMO listed (public)

`npm install -g web-ext` then `web-ext sign --channel listed`, or upload the zip via the [AMO Developer Hub](https://addons.mozilla.org/developers/). Gives a public add-on page, one-click install, and AMO-managed auto-updates. No fee. Choose this only if a public listing is acceptable; otherwise prefer unlisted/self-hosted above.

### Enterprise policy (no store interaction beyond signing)

If IT manages Firefox, use an [`policies.json` / GPO `ExtensionSettings`](https://mozilla.github.io/policy-templates/#extensionsettings) entry with `installation_mode: force_installed` and `install_url` pointing at the self-hosted signed `.xpi`.

---

## Release checklist

1. Edit the userscript (source of truth) and bump its `@version`.
2. Bump `version` in `extension/manifest.json` to match.
3. `npm run build && npm run lint` — expect 0 errors. (One Firefox-for-Android notice is expected and irrelevant; this is a desktop tool.)
4. Upload `dist/…zip` to the Chrome Web Store, and/or `npm run sign:firefox` and attach the `.xpi` to a GitHub Release.
5. If self-hosting the Firefox xpi with auto-update, add the new version to `updates.json`.
