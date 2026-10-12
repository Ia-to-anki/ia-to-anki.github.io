# Operations playbook

Owner: Martin (owner of the Ia-to-anki GitHub organization, receives any revenue). Live site: https://ia-to-anki.github.io/
Maintainer: Claude, through a weekly scheduled task.

## Weekly run

1. Pull `main`. Run `node tests/run.js`. If a test fails, fix it first and do nothing else that week.
2. Take the next **two** unchecked items in `docs/BACKLOG.md`.
3. For each item, write `content/guides/<lang>/<slug>.json` (format documented at the top of `scripts/build.py`).
   - 300 to 600 words of original, useful text. Explain the real problem and how to solve it.
   - Only describe features the tool actually has. No invented statistics, reviews, testimonials or user counts.
   - A translation is a natural rewrite for that language, not a word-for-word copy. Keep the same slug as the English page.
   - Title 50–65 characters, description 120–160 characters, with the main search phrase near the start.
4. Run `python3 scripts/build.py` then `node tests/run.js`.
5. Commit (`Add guide: <lang>/<slug>`) and push to `main`. Never force-push. Tick the items in `docs/BACKLOG.md`.
6. Send Martin a short report in French: pages added (with links), anything broken, anything he needs to do.

## Never without Martin's written OK

- Adding payment links, ads, affiliate links or a "Pro" version.
- Adding analytics or any third-party tracker.
- Deleting or renaming published pages (it breaks search rankings). Never delete google222ca29c6c43fe83.html: it keeps the site verified in Google Search Console.
- Changing the domain or the repository settings.

## Waiting on Martin

- Google Search Console: create a property for the site and give Claude the verification file name or meta tag.
- Analytics (privacy-friendly, e.g. a free GoatCounter account): needed to know which pages bring visitors.
- Payment account for a future Pro version, once traffic justifies it.
