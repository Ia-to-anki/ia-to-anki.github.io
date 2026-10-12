# -*- coding: utf-8 -*-
"""Builds the static site: one tool page per language, guide pages, sitemap and robots.txt.
Run from the repository root:  python3 scripts/build.py

Guide pages live in content/guides/<lang>/<slug>.json, for example:
{
  "title": "...",            # <title>, 50-65 characters
  "description": "...",      # meta description, 120-160 characters
  "h1": "...",
  "sub": "...",              # one or two sentences under the H1
  "nav": "...",              # short link text used in the footer list
  "sections": [ {"h2": "...", "paragraphs": ["...", "..."], "list": ["...", "..."]} ]
}
Each guide page embeds the same tool, followed by its sections and the language's FAQ.
A guide with the same slug in several languages is linked with hreflang automatically.
"""
import glob
import html
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
from i18n import L, FORMATS, BRAND, ORDER  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SITE = os.environ.get("SITE_URL", "https://jaulentmart-hash.github.io/ai-to-anki/")
VERSION = "2"

FONTS = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=JetBrains+Mono:wght@400;500&family=Source+Sans+3:wght@400;600;700&display=swap"

LOGO = ('<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="7" width="22" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>'
        '<rect x="7" y="10" width="22" height="16" rx="3" fill="var(--accent)"/><path d="M12 18h9m-3-3 3 3-3 3" fill="none" stroke="var(--accent-ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>')

GUIDES_LABEL = {"en": "Guides", "fr": "Guides", "es": "Guías", "pt": "Guias", "de": "Anleitungen", "it": "Guide"}


def e(s):
    return html.escape(s, quote=True)


def rel_path(lang, slug=None):
    """Path of a page relative to the site root, e.g. '', 'fr/', 'fr/claude-to-anki/'."""
    p = "" if lang == "en" else lang + "/"
    return p + (slug + "/" if slug else "")


def url(lang, slug=None):
    return SITE + rel_path(lang, slug)


def load_guides():
    guides = {l: {} for l in ORDER}
    for f in sorted(glob.glob(os.path.join(ROOT, "content", "guides", "*", "*.json"))):
        lang = os.path.basename(os.path.dirname(f))
        slug = os.path.splitext(os.path.basename(f))[0]
        if lang in guides:
            with open(f, encoding="utf-8") as fh:
                guides[lang][slug] = json.load(fh)
    return guides


def render(lang, guides, slug=None):
    t = L[lang]
    g = guides[lang][slug] if slug else None
    here = rel_path(lang, slug)
    prefix = "../" * here.count("/")

    def link_to(l, s=None):
        target = rel_path(l, s)
        return (prefix + target) or "./"

    # hreflang alternates: languages that have this same page.
    langs_with_page = [l for l in ORDER if (slug is None or slug in guides[l])]
    alt = "\n".join('<link rel="alternate" hreflang="%s" href="%s">' % (L[l]["htmlLang"], url(l, slug)) for l in langs_with_page)
    if "en" in langs_with_page:
        alt += '\n<link rel="alternate" hreflang="x-default" href="%s">' % url("en", slug)
    langs = "".join('<a href="%s"%s lang="%s">%s</a>' % (
        link_to(l, slug if l in langs_with_page else None),
        ' aria-current="page"' if l == lang else "",
        L[l]["htmlLang"], e(L[l]["langName"])) for l in ORDER)

    title = g["title"] if g else t["title"]
    description = g["description"] if g else t["description"]
    h1 = g["h1"] if g else t["h1"]
    sub = g["sub"] if g else t["sub"]

    i18n_js = {
        "status": t["status"], "remove": t["remove"], "download": t["download"], "downloadEmpty": t["downloadEmpty"],
        "building": t["building"], "done": t["done"], "error": t["error"], "emptyPreview": t["emptyPreview"],
        "unknown": t["unknown"], "copy": t["copy"], "copied": t["copied"], "deckDefault": t["deckDefault"],
        "example": t["example"], "formats": FORMATS[lang],
    }
    i18n_json = json.dumps(i18n_js, ensure_ascii=False).replace("</", "<\\/")

    ld = [{
        "@context": "https://schema.org", "@type": "WebApplication", "name": BRAND[lang], "url": url(lang),
        "applicationCategory": "EducationalApplication", "operatingSystem": "Any (web browser)",
        "inLanguage": t["htmlLang"], "description": t["description"],
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
    }, {
        "@context": "https://schema.org", "@type": "FAQPage", "inLanguage": t["htmlLang"],
        "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in t["faq"]],
    }]
    if g:
        ld = [{"@context": "https://schema.org", "@type": "Article", "headline": h1, "description": description,
               "inLanguage": t["htmlLang"], "url": url(lang, slug), "dateModified": date.today().isoformat()}] + ld[:1]
    ld_json = json.dumps(ld, ensure_ascii=False).replace("</", "<\\/")

    badges = "".join("<li>%s</li>" % e(b) for b in t["badges"])
    steps = "".join("<li><h3>%s</h3><p>%s</p></li>" % (e(a), e(b)) for a, b in t["steps"])
    formats = "".join("<li>%s</li>" % e(f) for f in t["formatsList"])
    faq = "".join("<details><summary>%s</summary><p>%s</p></details>" % (e(q), e(a)) for q, a in t["faq"])

    article = ""
    if g:
        for s in g.get("sections", []):
            article += '<section class="block"><h2>%s</h2>' % e(s["h2"])
            article += "".join("<p>%s</p>" % e(p) for p in s.get("paragraphs", []))
            if s.get("list"):
                article += '<ul class="plain">' + "".join("<li>%s</li>" % e(i) for i in s["list"]) + "</ul>"
            article += "</section>"

    guide_links = "".join('<li><a href="%s">%s</a></li>' % (link_to(lang, s), e(gd.get("nav", gd["h1"])))
                          for s, gd in guides[lang].items() if s != slug)
    guides_nav = ('<nav class="guides" aria-label="%s"><h2>%s</h2><ul>%s</ul></nav>' % (GUIDES_LABEL[lang], GUIDES_LABEL[lang], guide_links)) if guide_links else ""
    home_link = '<p><a href="%s">%s</a></p>' % (link_to(lang), e(BRAND[lang])) if slug else ""

    content_sections = article
    if not g:
        content_sections += f"""
  <section class="block">
    <h2>{e(t['howH'])}</h2>
    <ol class="steps">{steps}</ol>
  </section>

  <section class="block">
    <h2>{e(t['formatsH'])}</h2>
    <ul class="formats">{formats}</ul>
  </section>"""

    return f"""<!doctype html>
<html lang="{t['htmlLang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{url(lang, slug)}">
{alt}
<meta property="og:type" content="{'article' if g else 'website'}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{url(lang, slug)}">
<meta property="og:locale" content="{t['ogLocale']}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#2B56D9">
<link rel="icon" href="{prefix}assets/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONTS}">
<link rel="stylesheet" href="{prefix}assets/style.css?v={VERSION}">
<script type="application/ld+json">{ld_json}</script>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="{link_to(lang)}">{LOGO}<span>{e(BRAND[lang])}</span></a>
    <nav class="langs" aria-label="Language">{langs}</nav>
  </header>

  <section class="hero">
    <h1>{e(h1)}</h1>
    <p>{e(sub)}</p>
    <ul class="badges">{badges}</ul>
  </section>

  <main class="tool">
    <div class="panel">
      <div class="panel-head">
        <h2><span class="step">01</span>{e(t['pasteH'])}</h2>
        <div><button type="button" class="linkbtn" id="example">{e(t['exampleBtn'])}</button><button type="button" class="linkbtn" id="clear">{e(t['clear'])}</button></div>
      </div>
      <textarea id="input" spellcheck="false" aria-label="{e(t['pasteH'])}" placeholder="{e(t['placeholder'])}"></textarea>
      <div class="opts">
        <label class="field" for="deck">{e(t['deckLabel'])}<input type="text" id="deck" placeholder="{e(t['deckDefault'])}" autocomplete="off"></label>
        <label class="field" for="tags">{e(t['tagsLabel'])}<input type="text" id="tags" placeholder="{e(t['tagsPh'])}" autocomplete="off"></label>
        <div class="checks">
          <label for="math"><input type="checkbox" id="math" checked>{e(t['mathLabel'])}</label>
          <label for="reversed"><input type="checkbox" id="reversed">{e(t['revLabel'])}</label>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2><span class="step">02</span>{e(t['previewH'])}</h2>
        <span class="status" id="status" aria-live="polite"></span>
      </div>
      <div class="cards" id="cards"></div>
      <div class="dl">
        <button type="button" class="btn" id="download" disabled>{e(t['downloadEmpty'])}</button>
        <p class="msg" id="msg" aria-live="polite"></p>
        <p class="hint">{e(t['importHint'])}</p>
      </div>
    </div>
  </main>

  <section class="block" id="prompt">
    <h2>{e(t['promptH'])}</h2>
    <p>{e(t['promptP'])}</p>
    <div class="prompt">
      <pre id="prompt-text">{e(t['promptText'])}</pre>
      <button type="button" class="copy" data-copy="prompt-text">{e(t['copy'])}</button>
    </div>
  </section>
{content_sections}

  <section class="block">
    <h2>{e(t['faqH'])}</h2>
    <div class="faq">{faq}</div>
  </section>

  <footer class="foot">
    {guides_nav}
    {home_link}
    <p>{e(t['privacy'])}</p>
    <p>{e(t['disclaimer'])}</p>
  </footer>
</div>
<script src="{prefix}assets/vendor/sql-wasm.js"></script>
<script src="{prefix}assets/vendor/jszip.min.js"></script>
<script src="{prefix}assets/parse.js?v={VERSION}"></script>
<script src="{prefix}assets/apkg.js?v={VERSION}"></script>
<script>window.I18N = {i18n_json}; window.ASSET_BASE = "{prefix}assets/";</script>
<script src="{prefix}assets/app.js?v={VERSION}"></script>
</body>
</html>
"""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    guides = load_guides()
    pages = []
    for lang in ORDER:
        write(os.path.join(ROOT, rel_path(lang), "index.html"), render(lang, guides))
        pages.append((lang, None))
        for slug in guides[lang]:
            write(os.path.join(ROOT, rel_path(lang, slug), "index.html"), render(lang, guides, slug))
            pages.append((lang, slug))

    today = date.today().isoformat()
    urls = []
    for lang, slug in pages:
        same = [l for l in ORDER if slug is None or slug in guides[l]]
        alts = "".join('<xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (L[l]["htmlLang"], url(l, slug)) for l in same) if len(same) > 1 else ""
        urls.append("<url><loc>%s</loc><lastmod>%s</lastmod>%s</url>" % (url(lang, slug), today, alts))
    write(os.path.join(ROOT, "sitemap.xml"),
          '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
          + "\n".join(urls) + "\n</urlset>\n")
    write(os.path.join(ROOT, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: %ssitemap.xml\n" % SITE)
    print("Built %d pages" % len(pages))


if __name__ == "__main__":
    main()
