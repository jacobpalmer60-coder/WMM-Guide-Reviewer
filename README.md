# WMM Guide Reviewer

Scrapes Google Maps reviews for the [World Museum of Mining](https://miningmuseum.org/)
(Butte, MT) and builds a static page for comparing tour guides by name, rating, and date.

**This must be run on your own machine, not in a network-restricted cloud sandbox** —
Google Maps isn't reachable from some hosted environments.

## Setup

```bash
git clone <this repo>
cd WMM-Guide-Reviewer
git checkout claude/mining-museum-reviews-scraper-dhhlwq
npm install
npx playwright install chromium
```

## Usage

```bash
npm run scrape   # opens Google Maps, scrolls through all reviews, writes data/reviews.json
npm run build    # turns data/reviews.json into site/index.html
# or both:
npm run all
```

Then open `site/index.html` in a browser. It's a static file with the review data
baked in — no server needed.

### Options

`npm run scrape` accepts flags (pass them after `--`):

- `--headful` — watch the browser instead of running headless (useful for debugging)
- `--max <n>` — stop after collecting roughly `n` reviews (default: all of them)
- `--debug` — dump the raw reviews panel HTML to `.debug/feed.html`
- `--url "<google maps place url>"` — scrape a specific place URL instead of searching by name
- `--out <path>` — write output somewhere other than `data/reviews.json`

Example: `npm run scrape -- --headful --max 50`

## How guide names are found

Google doesn't tag reviews with a "tour guide" field, so `scripts/scrape.mjs` runs a
few regex heuristics over each review's text (patterns like "guide X was...", "X was
our guide", "thanks to X for...") to guess which capitalized name is the guide being
praised. This is approximate — the viewer always shows the full review text too, so
you can eyeball anything the heuristic misses or mis-tags.

## If Google changes their page and the scraper breaks

Google periodically rotates internal class names. `scripts/scrape.mjs` intentionally
avoids those and keys off more stable `aria-label`/`role` attributes (e.g.
`[aria-label^="Photo of "]` for the reviewer, `[role="img"][aria-label*="star"]` for
the rating, `div[role="feed"]` for the scrollable list). If it still breaks, run with
`--debug`, inspect `.debug/feed.html`, and adjust the selectors in `scrollAndCollect()`.

## Notes

- Scraping Google Maps reviews is against Google's Terms of Service. This is intended
  for personal, small-scale, non-commercial use (comparing tour guides before a visit),
  not for redistribution or heavy automated traffic.
- Relative dates ("2 months ago") are converted to an approximate ISO date based on
  when the scrape ran — Google doesn't expose exact review dates in the UI.
