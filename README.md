# WMM Guide Reviewer

Pulls Google reviews for the [World Museum of Mining](https://miningmuseum.org/) (Butte, MT)
and builds a browsable page for comparing tour guides by name, rating, and date.

## Status

Scaffolding only so far — `playwright` is installed for the scraper, but the actual
scraper/viewer implementation depends on which data-source approach we land on
(the sandbox this was set up in can't reach google.com to test a live scraper against
it; see conversation for details). Next: implement `scripts/scrape.mjs` and `site/`.
