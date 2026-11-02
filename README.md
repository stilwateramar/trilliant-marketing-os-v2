# Trilliant Digital Marketing OS, V2

A performance-marketing tool for agencies. Per client it covers **budget allocation** (with a Re-allocate button, min/max per channel, creative-fatigue penalty), **keyword actions**, **audience segments** and **creative fatigue / ad copy**.

**V2 is 100% client-side.** There is no server, no database and no login. It is a static site: `public/index.html` plus JavaScript. Data lives in the browser's localStorage and files you load are read in the browser and never uploaded.

## What changed from V1
| V1 | V2 |
|---|---|
| Node/Express server, Postgres, Google Ads + Meta OAuth sync | Removed. Static files only |
| Always started with sample clients | **Start screen:** "Start with demo data" or "Upload my data" |
| Rows could repeat (same date twice, same keyword twice) | **De-duplication on every load** (see below) |
| Sample numbers filled any tab you had no file for | Missing files show an empty state, never made-up numbers |
| Ad copy needed the Claude artifact or a server key | Optional: paste your own Anthropic API key in the Creative tab (kept in your browser) |

## Run locally
```bash
npm run dev          # serves ./public on http://localhost:3000  (or: python3 -m http.server -d public 3000)
```

## Using it
1. **Start with demo data**: three fictional clients with full data for every tab.
2. **Upload my data**: name the client and choose CSV files. Only `channels.csv` is required. Example files are in `sample-data/`.
3. Add more clients any time with **Add client**. Re-uploading a file inside a tab **replaces** that table.
4. **Export new budgets** (CSV) and **Export full report** (JSON) download from the browser.
5. **Reset all data** wipes everything stored in the browser and returns to the start screen.

### File formats
| File | Columns | Notes |
|---|---|---|
| channels | `date,channel,spend,revenue` (+ optional `conversions`) | One row per channel per day, at least 8 days with spend per channel. Dates `YYYY-MM-DD` or `DD/MM/YYYY` |
| keywords | `keyword,impressions,clicks,conversions,cost,revenue` | Google Ads search-terms names (`Search term`, `Impr.`, `Conv. value`) also work |
| creatives | `date,channel,creative,impressions,clicks` | At least 8 days per creative |
| audience | `customer_id` (optional), `recency_days,frequency,monetary,age,sessions_per_wk` | At least 30 customers |

Comma, semicolon and tab separated files are all accepted.

### No duplicates
- Rows identical in every column are dropped.
- Rows describing the same thing are **combined by summing**, never listed twice: same channel+date, same keyword (case-insensitive), same creative+channel+date. If you have a `customer_id` column, the same id counts once.
- A summary after each load says how many rows were removed or combined.
- Uploading again replaces the table; it never appends a second copy.
- A client name can exist only once. Demo clients are never added twice.

## Deploy on Render (free static site)
Render serves static sites for free. Push this folder to GitHub, then either:
- **Blueprint:** Render dashboard, New, Blueprint, pick the repo (`render.yaml` is included); or
- **Manual:** New, Static Site, publish directory `public`, build command empty.

`CLAUDE_CODE_PROMPT.md` automates this with your Render API key.

## Limits (honest list)
- Data is per browser/device. Clearing site data or switching browsers loses it; export reports you want to keep.
- localStorage is about 5 MB. A very large customer file may not persist (you get a warning and it works for that visit).
- No live Google Ads / Meta connection in V2; use their CSV exports.
- Budget moves are recommendations from a fitted response curve, exported as CSV. They are not pushed to the ad platforms.
- The browser-side Claude call for ad copy uses Anthropic's browser-access header and has not been run against the live API in testing.
- Anyone with the Render URL can open the site (it has no login). They would see only their own browser's data, but the demo data is visible. Add a login or Render IP restrictions if that matters.

## Tests
`pip install playwright && playwright install chromium && python3 tests/smoke.py` (demo flow, upload flow, de-duplication, empty states, bad files).
