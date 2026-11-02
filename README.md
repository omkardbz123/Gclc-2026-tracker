# GCLC 2026 Progress Tracker

A simple static site that shows daily progress for Google Cloud Learn With Communities 2026 participants. It is hosted on GitHub Pages and has no server and no database.

- **Public page:** `/` shows a search box, sortable leaderboard, and summary stats.
- **Admin page:** `/admin/` is not linked from the public page. Organizers sign in and upload the day's CSV.

## Daily update (admins)

1. Open `<site>/admin/` and sign in.
2. Drop in today's CSV export. Several files can be dropped at once. They are merged, and the same participant is never counted twice.
3. Check the preview, then press **Publish to site**. The live page refreshes in about a minute.

Email and phone columns are removed automatically before anything is published. Every upload is also kept in `data/history/`.

## One-time setup

The admin page publishes through the GitHub API, so it needs a GitHub token, entered once on the hidden page `/admin/setup/`:

- an admin username and password
- a fine-grained GitHub token limited to this repository, with **Contents: Read and write** permission

The token is encrypted with the username and password (PBKDF2 + AES-GCM) and saved as `admin/key.json`. After that, `/admin/` shows only username and password. To change the password or replace an expired token, open `/admin/setup/` again.

## Logo

Put the official GDG chapter logo file at `assets/logo.png`. It shows up in the header automatically.

## Files

| Path | What it is |
|---|---|
| `index.html`, `js/app.js`, `styles.css` | Public page |
| `admin/` | Admin page |
| `js/csv-core.js` | CSV parsing, merging, de-duplication and privacy filtering |
| `js/config.js` | Repo name and site title |
| `data/data.csv` | Currently published data |
| `data/history/` | Every past upload |
