/*
 * apkg.js — builds an Anki package (.apkg) entirely in the browser.
 * Legacy collection format (schema 11), which every current Anki client imports:
 * Anki desktop, AnkiDroid and AnkiMobile.
 * Dependencies are injected so the same code runs in the browser and in Node tests:
 *   SQL   — the sql.js module (initSqlJs result)
 *   JSZip — the JSZip constructor
 *   sha1  — async (string) => hex digest
 */
(function (root) {
  "use strict";

  const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

  const CSS = `.card {
  font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 22px;
  line-height: 1.45;
  text-align: center;
  color: #1b1f24;
  background: #ffffff;
  padding: 12px;
}
.nightMode.card, .night_mode .card { color: #e8eaed; background: #1e2023; }
.cloze { font-weight: 700; color: #2f6fdb; }
.nightMode .cloze, .night_mode .cloze { color: #8ab4ff; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; padding: 1px 4px; border-radius: 4px; background: rgba(127,127,127,.15); }
ul, ol { text-align: left; display: inline-block; margin: 0; }
hr#answer { margin: 16px 0; }`;

  const LATEX_PRE = "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n";
  const LATEX_POST = "\\end{document}";

  // Stable model ids so re-importing updates the same note types instead of duplicating them.
  const MODEL_IDS = { basic: 1739000000101, reversed: 1739000000102, cloze: 1739000000103 };

  function field(name, ord) {
    return { name: name, ord: ord, font: "Arial", media: [], rtl: false, size: 20, sticky: false };
  }
  function tmpl(name, ord, qfmt, afmt) {
    return { name: name, ord: ord, qfmt: qfmt, afmt: afmt, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 };
  }

  function buildModels(deckId, now) {
    const base = { css: CSS, did: deckId, latexPre: LATEX_PRE, latexPost: LATEX_POST, mod: now, sortf: 0, tags: [], usn: -1, vers: [] };
    const basic = Object.assign({}, base, {
      id: MODEL_IDS.basic, name: "AI to Anki — Basic", type: 0,
      flds: [field("Front", 0), field("Back", 1)],
      tmpls: [tmpl("Card 1", 0, "{{Front}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}")],
      req: [[0, "any", [0]]]
    });
    const reversed = Object.assign({}, base, {
      id: MODEL_IDS.reversed, name: "AI to Anki — Basic + reversed", type: 0,
      flds: [field("Front", 0), field("Back", 1)],
      tmpls: [
        tmpl("Card 1", 0, "{{Front}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}"),
        tmpl("Card 2", 1, "{{Back}}", "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}")
      ],
      req: [[0, "any", [0]], [1, "any", [1]]]
    });
    const cloze = Object.assign({}, base, {
      id: MODEL_IDS.cloze, name: "AI to Anki — Cloze", type: 1,
      flds: [field("Text", 0), field("Back Extra", 1)],
      tmpls: [tmpl("Cloze", 0, "{{cloze:Text}}", "{{cloze:Text}}<br>\n{{Back Extra}}")],
      req: [[0, "any", [0]]]
    });
    return { basic: basic, reversed: reversed, cloze: cloze };
  }

  function deckJson(id, name, now) {
    return {
      id: id, name: name, desc: "", conf: 1, dyn: 0, collapsed: false, browserCollapsed: false,
      extendNew: 0, extendRev: 50, mod: now, usn: -1,
      newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0]
    };
  }

  const DCONF = {
    "1": {
      id: 1, name: "Default", mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 }
    }
  };

  const GUID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
  function guid() {
    let s = "";
    for (let i = 0; i < 10; i++) s += GUID_CHARS[Math.floor(Math.random() * GUID_CHARS.length)];
    return s;
  }

  function stripHtml(s) {
    return String(s)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
      .trim();
  }

  function clozeOrds(text) {
    const set = new Set();
    const re = /\{\{c(\d+)::/g;
    let m;
    while ((m = re.exec(text))) set.add(parseInt(m[1], 10) - 1);
    return Array.from(set).sort((a, b) => a - b);
  }

  // Deterministic 13-digit deck id from the name, so the same deck name lands in the same deck.
  function deckIdFor(name) {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return 1500000000000 + (h % 400000000000);
  }

  /**
   * opts: { SQL, JSZip, sha1, deckName, reversed (bool), cards: [{type:'basic'|'cloze', front, back, tags:[]}] }
   * returns Promise<Uint8Array>
   */
  async function buildApkg(opts) {
    const SQL = opts.SQL, JSZip = opts.JSZip, sha1 = opts.sha1;
    const deckName = (opts.deckName || "AI to Anki").trim() || "AI to Anki";
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const deckId = deckIdFor(deckName);
    const models = buildModels(deckId, now);
    const basicModel = opts.reversed ? models.reversed : models.basic;

    const db = new SQL.Database();
    db.run(SCHEMA);

    const usedModels = {};
    const conf = {
      activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: deckId, curModel: String(basicModel.id),
      dueCounts: true, estTimes: true, newBury: true, newSpread: 0, nextPos: 1, sortBackwards: false, sortType: "noteFld", timeLim: 0
    };
    const decks = {};
    decks["1"] = deckJson(1, "Default", now);
    decks[String(deckId)] = deckJson(deckId, deckName, now);

    const noteStmt = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const cardStmt = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

    let nid = nowMs;
    let cid = nowMs;
    let due = 0;
    let cardCount = 0;
    for (const c of opts.cards) {
      const isCloze = c.type === "cloze";
      const model = isCloze ? models.cloze : basicModel;
      const f0 = c.front || "";
      const f1 = c.back || "";
      let ords;
      if (isCloze) {
        ords = clozeOrds(f0);
        if (!ords.length) continue;
      } else {
        ords = model.tmpls.map(t => t.ord);
        if (opts.reversed && !stripHtml(f1)) ords = [0];
      }
      usedModels[String(model.id)] = model;
      const tags = (c.tags || []).map(t => String(t).trim().replace(/\s+/g, "_")).filter(Boolean);
      const tagStr = tags.length ? " " + tags.join(" ") + " " : "";
      const sfld = stripHtml(f0);
      const hex = await sha1(sfld);
      const csum = parseInt(hex.slice(0, 8), 16);
      nid += 1;
      noteStmt.run([nid, guid(), model.id, now, -1, tagStr, f0 + "\x1f" + f1, sfld, csum, 0, ""]);
      due += 1;
      for (const ord of ords) {
        cid += 1;
        cardStmt.run([cid, nid, deckId, ord, now, -1, 0, 0, due, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
        cardCount += 1;
      }
    }
    noteStmt.free();
    cardStmt.free();

    if (!Object.keys(usedModels).length) usedModels[String(basicModel.id)] = basicModel;
    db.run("INSERT INTO col VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      1, now, nowMs, nowMs, 11, 0, 0, 0,
      JSON.stringify(conf), JSON.stringify(usedModels), JSON.stringify(decks), JSON.stringify(DCONF), "{}"
    ]);

    const bytes = db.export();
    db.close();
    const zip = new JSZip();
    zip.file("collection.anki2", bytes);
    zip.file("media", "{}");
    const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return { bytes: out, cards: cardCount };
  }

  const api = { buildApkg: buildApkg, stripHtml: stripHtml, clozeOrds: clozeOrds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Apkg = api;
})(typeof self !== "undefined" ? self : this);
