#!/usr/bin/env node
// Scrapes Google Maps reviews for a place and writes data/reviews.json.
// Run locally (not in a network-restricted sandbox) — see README.md.

import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const DEFAULT_QUERY = 'World Museum of Mining, 155 Museum Way, Butte, MT 59701';

function parseArgs(argv) {
  const args = { query: DEFAULT_QUERY, max: Infinity, headful: false, debug: false, out: 'data/reviews.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--query') args.query = argv[++i];
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--headful') args.headful = true;
    else if (a === '--debug') args.debug = true;
    else if (a === '--out') args.out = argv[++i];
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base, spread) => base + Math.random() * spread;

async function acceptConsentIfPresent(page) {
  try {
    if (/consent\.google\.com/.test(page.url())) {
      const btn = page.getByRole('button', { name: /accept all/i });
      if (await btn.count()) {
        await btn.first().click();
        await page.waitForLoadState('domcontentloaded');
      }
    }
    const inlineBtn = page.getByRole('button', { name: /accept all|i agree/i });
    if (await inlineBtn.count()) {
      await inlineBtn.first().click({ timeout: 3000 }).catch(() => {});
    }
  } catch {
    // no consent dialog — fine
  }
}

async function openReviewsPanel(page) {
  await page.waitForSelector('h1', { timeout: 30000 });

  // If Maps landed on a multi-result list instead of a single place, open the first result.
  const feedLinks = page.locator('div[role="feed"] a[href*="/maps/place/"]');
  if (await feedLinks.count()) {
    await feedLinks.first().click();
    await page.waitForSelector('h1', { timeout: 30000 });
  }

  // Open the reviews tab/panel. Google rotates class names, so prefer aria-label/text.
  const reviewEntryCandidates = [
    page.getByRole('button', { name: /reviews for/i }),
    page.getByText(/^[\d,]+\s+reviews?$/i),
    page.getByRole('tab', { name: /reviews/i }),
  ];
  for (const candidate of reviewEntryCandidates) {
    if (await candidate.count().catch(() => 0)) {
      await candidate.first().click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }

  await page.waitForSelector('div[role="feed"]', { timeout: 30000 });

  // Sort by newest so relative-date math stays meaningful; best-effort.
  try {
    const sortBtn = page.getByRole('button', { name: /sort/i });
    if (await sortBtn.count()) {
      await sortBtn.first().click({ timeout: 3000 });
      const newest = page.getByRole('menuitemradio', { name: /newest/i });
      if (await newest.count()) await newest.first().click({ timeout: 3000 });
    }
  } catch {
    // sort UI not found — proceed with default order
  }
}

async function expandTruncatedReviews(page) {
  const moreButtons = page.locator('div[role="feed"] button', { hasText: /^more$/i });
  const count = await moreButtons.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    await moreButtons.nth(i).click({ timeout: 1000 }).catch(() => {});
  }
}

async function scrollAndCollect(page, max) {
  const feed = page.locator('div[role="feed"]');
  let stableRounds = 0;
  let lastCount = 0;

  while (stableRounds < 4) {
    const count = await page.locator('div[role="feed"] [aria-label^="Photo of "]').count();
    if (count >= max) break;
    if (count === lastCount) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastCount = count;
    }
    await feed.evaluate((el) => el.scrollBy(0, el.scrollHeight));
    await sleep(jitter(700, 500));
  }

  await expandTruncatedReviews(page);
  await sleep(300);

  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('div[role="feed"] > div')).filter((el) =>
      el.querySelector('[aria-label^="Photo of "]')
    );

    const RELATIVE_DATE_RE =
      /^(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago(\s*\(Edited\))?$/i;

    return cards.map((card) => {
      const authorEl = card.querySelector('[aria-label^="Photo of "]');
      const author = authorEl ? authorEl.getAttribute('aria-label').replace(/^Photo of /, '').trim() : null;

      const ratingEl = card.querySelector('[role="img"][aria-label*="star"]');
      const ratingLabel = ratingEl ? ratingEl.getAttribute('aria-label') : '';
      const ratingMatch = ratingLabel && ratingLabel.match(/[\d.]+/);
      const rating = ratingMatch ? parseFloat(ratingMatch[0]) : null;

      const allText = Array.from(card.querySelectorAll('span, div'))
        .map((n) => n.textContent.trim())
        .filter(Boolean);

      const relativeDate = allText.find((t) => RELATIVE_DATE_RE.test(t)) || null;

      // Longest text block that isn't the name/date/rating/UI chrome is treated as the review body.
      const excluded = new Set([author, relativeDate, ratingLabel, 'Like', 'Share', 'More', 'Less']);
      const bodyCandidates = allText.filter(
        (t) => !excluded.has(t) && !RELATIVE_DATE_RE.test(t) && !/^Local Guide/.test(t) && t.length > 15
      );
      const text = bodyCandidates.sort((a, b) => b.length - a.length)[0] || '';

      return { author, rating, relativeDate, text };
    });
  });
}

const STOPWORDS = new Set([
  'Museum', 'Butte', 'Orphan', 'Girl', 'Mine', 'Hell', 'Roarin', 'Gulch', 'World', 'Montana',
  'Mining', 'Tour', 'Guide', 'Underground', 'Local', 'Google', 'The', 'This', 'Our', 'We', 'Great',
  'Thank', 'Thanks', 'Highly', 'Definitely', 'Very', 'Really',
]);

function extractGuideMentions(text) {
  if (!text) return [];
  const patterns = [
    /\b(?:tour guide|our guide|guide named|guide was|guide,)\s+([A-Z][a-zA-Z'’-]+)/g,
    /\bguide\s+([A-Z][a-zA-Z'’-]+)\s+(?:was|is)\b/g,
    /\b([A-Z][a-zA-Z'’-]+)\s+(?:was|is)\s+(?:our|my|the)?\s*(?:tour\s+)?guide/g,
    /\bthanks?\s+(?:to\s+)?([A-Z][a-zA-Z'’-]+)\s+(?:for|who)/gi,
  ];
  const names = new Set();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (name && name.length >= 3 && !STOPWORDS.has(name)) names.add(name);
    }
  }
  return [...names];
}

function relativeToApproxDate(relativeDate, scrapedAt) {
  if (!relativeDate) return null;
  const m = relativeDate.match(/^(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const n = /^(a|an)$/i.test(m[1]) ? 1 : parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const msPerUnit = {
    second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000,
    week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
  };
  const date = new Date(scrapedAt.getTime() - n * msPerUnit[unit]);
  return date.toISOString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scrapedAt = new Date();

  const browser = await chromium.launch({ headless: !args.headful });
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const url = args.url || `https://www.google.com/maps/search/${encodeURIComponent(args.query)}`;
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await acceptConsentIfPresent(page);
  await openReviewsPanel(page);

  console.log('Scrolling and collecting reviews (this can take a while for a long list)...');
  const raw = await scrollAndCollect(page, args.max);
  console.log(`Collected ${raw.length} review cards.`);

  if (args.debug) {
    const debugDir = path.join(ROOT, '.debug');
    await mkdir(debugDir, { recursive: true });
    const html = await page.locator('div[role="feed"]').first().evaluate((el) => el.outerHTML);
    await writeFile(path.join(debugDir, 'feed.html'), html, 'utf8');
    console.log(`Debug HTML written to .debug/feed.html`);
  }

  const reviews = raw
    .filter((r) => r.author)
    .map((r, i) => ({
      id: i,
      author: r.author,
      rating: r.rating,
      relativeDate: r.relativeDate,
      approxDate: relativeToApproxDate(r.relativeDate, scrapedAt),
      text: r.text,
      guideMentions: extractGuideMentions(r.text),
    }));

  const output = {
    place: args.query,
    sourceUrl: page.url(),
    scrapedAt: scrapedAt.toISOString(),
    count: reviews.length,
    reviews,
  };

  const outPath = path.join(ROOT, args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${reviews.length} reviews to ${args.out}`);

  await browser.close();
}

main().catch((err) => {
  console.error('Scrape failed:', err);
  process.exit(1);
});
