# OpenXiv arxiv.org overlay (MV3)

A Chrome / Edge / Firefox MV3 content script that injects a small sidebar on `arxiv.org/abs/*` pages with OpenXiv Trust Passport lane badges for the matching paper (if one exists).

## Install (developer mode)

1. Open `chrome://extensions` (or the equivalent on your browser).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder (`apps/extension`).
4. Open the extension's **Options** page and set the API base URL — default `http://localhost:4000` for local dev.
5. Visit any `arxiv.org/abs/<id>` page. The sidebar appears in the top-right.

## How matching works

1. Content script extracts the arXiv id from the URL.
2. Calls `${API_BASE}/api/lookup?arxiv_id=...`.
3. If OpenXiv has a matching paper, the sidebar shows Trust Passport lane badges + link to `/abs/{openxiv-id}`.
4. Otherwise it shows a "Not on OpenXiv yet — submit?" CTA.

The lookup endpoint isn't implemented in the API yet — the script handles its absence gracefully (404 → "Not on OpenXiv yet").

## Icons

Pending — replace `icon-16.png` etc with real assets before publishing.
