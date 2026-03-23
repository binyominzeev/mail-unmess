# mail-unmess

Gmail browser extension for instant CRM experience — manage email threads as simple tickets.

## Features

* **Status tracking** — assign TODO / DOING / DONE to any Gmail thread.
* **Notes** — write a short note per thread.
* **Persistent** — data is saved with `chrome.storage.local` and restored automatically when you re-open the same thread.
* **Colour indicator** — a coloured bar reflects the current status (yellow = TODO, blue = DOING, green = DONE).
* **Non-intrusive** — small floating panel; does not alter the Gmail layout.

## File structure

```
mail-unmess/
├── manifest.json   # Manifest V3 extension config
├── content.js      # Content script — injects panel into Gmail
├── styles.css      # Panel styles
└── README.md
```

## How to load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `mail-unmess` directory (the folder that contains `manifest.json`).
5. Open [Gmail](https://mail.google.com) and open any email thread — the **📌 Thread Ticket** panel will appear in the top-right corner.

## Usage

1. Open an email thread in Gmail.
2. In the **📌 Thread Ticket** panel:
   * Choose a **Status** from the dropdown (TODO / DOING / DONE).
   * Optionally add a **Note**.
   * Click **Save**.
3. The next time you open the same thread the status and note will be restored automatically.

## Development notes

* Built with Manifest V3 — no background service worker is required (storage is handled directly from the content script).
* Thread identification is URL-based (the hash fragment that Gmail appends for each conversation).
* No external dependencies; pure HTML / CSS / JavaScript.
