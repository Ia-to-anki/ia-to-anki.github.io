# AI to Anki

Free web tool that turns flashcards written by ChatGPT, Claude, Gemini or any other AI into a clean Anki deck (`.apkg`).

**Live site:** https://ia-to-anki.github.io/

- Reads Q/A blocks (6 languages), Markdown tables, CSV / TSV / semicolon / pipe rows, cloze lines, glossaries and JSON.
- Converts `$…$` and `$$…$$` to Anki's MathJax delimiters `\(…\)` and `\[…\]`, leaves prices like `$5` alone.
- Converts Markdown (bold, italics, lists, code) to Anki-friendly HTML.
- Builds the `.apkg` file in the browser (SQLite via sql.js). Nothing is uploaded.
- Works with Anki desktop, AnkiDroid and AnkiMobile.
- Interface in English, French, Spanish, Portuguese, German and Italian.

## Structure

| Path | What it is |
|---|---|
| `assets/parse.js` | Turns pasted text into cards |
| `assets/apkg.js` | Builds the Anki package |
| `assets/app.js` | Page logic |
| `assets/style.css` | Styles |
| `assets/vendor/` | sql.js 1.10.3 and JSZip 3.10.1 |
| `scripts/i18n.py` | All interface text, per language |
| `content/guides/<lang>/<slug>.json` | Guide pages (SEO landing pages) |
| `scripts/build.py` | Generates every `index.html`, `sitemap.xml` and `robots.txt` |
| `tests/run.js` | Tests, no install needed |
| `docs/` | Operations playbook and content backlog |

## Build and test

```bash
python3 scripts/build.py
node tests/run.js
```

The generated HTML is committed, so GitHub Pages serves the repository as is (branch `main`, folder `/`).

---

AI to Anki is an independent project, not affiliated with Anki, AnkiWeb, OpenAI, Anthropic or Google.
