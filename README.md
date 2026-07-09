# Zendesk Userscripts

A collection of browser userscripts for Zendesk agents at limango, extending Zendesk's functionality in combination with the Limango 360 sidebar app.

---

## Installation

### Chrome
tbd

### Firefox
tbd

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

## Side Conversation Replacement Script

**File:** [`userscripts/side-conversation-replacement.user.js`](side-conversation-replacement/side-conversation-replacement.user.js)

Automatically replaces `[[limango.*]]` placeholders in the Zendesk side conversation composer (subject line and body) with live (order) data from the Limango 360 app currently open in the sidebar.

When an agent applies a macro containing placeholders, the script detects them, requests the resolved values from the Limango 360 iframe, and writes the result back into the composer — including proper handling of CKEditor's data pipeline for the body and React's controlled input for the subject field.

### How it works

1. A MutationObserver watches for the side conversation composer to open.
2. On open (or when content changes), any text containing `[[limango.*]]` placeholders are sent to the Limango 360 sidebar app via `postMessage`.
3. The app resolves the placeholders using the currently viewed order's data and posts the result back.
4. The script writes the resolved text into the subject input and CKEditor body.
