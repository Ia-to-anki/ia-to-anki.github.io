/*
 * parse.js — turns whatever an AI chatbot produced into clean Anki cards.
 * Handles: JSON, Markdown tables, Q/A blocks (6 languages), CSV/TSV/semicolon/pipe/"::" lines,
 * cloze lines, "term — definition" glossaries and two-line paragraphs.
 * Cleans: Markdown → HTML, $…$ / $$…$$ → \(…\) / \[…\] (Anki's MathJax delimiters), stray numbering.
 */
(function (root) {
  "use strict";

  const FRONT_LABELS = ["q", "question", "front", "recto", "pregunta", "anverso", "frente", "pergunta", "frage", "vorderseite", "domanda", "fronte", "prompt", "term", "terme", "término", "termo", "begriff", "termine"];
  const BACK_LABELS = ["a", "answer", "back", "verso", "réponse", "reponse", "respuesta", "reverso", "resposta", "antwort", "rückseite", "ruckseite", "risposta", "retro", "definition", "définition", "definición", "definição", "definizione"];
  const TAG_LABELS = ["tags", "tag", "étiquettes", "etiquetas", "etiquetas", "schlagwörter", "etichette"];

  const LABEL_RE = (list) => new RegExp(
    "^\\s*(?:[-*•]\\s*)?(?:\\d+[.)]\\s*)?(?:\\*\\*|__)?\\s*(" + list.map(esc).join("|") + ")\\s*\\d*\\s*(?:\\*\\*|__)?\\s*[:：]\\s*(?:\\*\\*|__)?\\s*(.*)$",
    "i"
  );
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  const FRONT_RE = LABEL_RE(FRONT_LABELS);
  const BACK_RE = LABEL_RE(BACK_LABELS);
  const TAG_RE = LABEL_RE(TAG_LABELS);

  const HEADER_WORDS = new Set(FRONT_LABELS.concat(BACK_LABELS, TAG_LABELS, ["#", "n°", "no", "nr", "text", "texte", "extra", "back extra", "notes"]));

  // ---------- field cleaning ----------

  const SAFE_TAGS = /&lt;(\/?)(b|i|u|em|strong|br|sub|sup|code|ul|ol|li|p|div|span|hr)(\s*\/?)&gt;/gi;

  function escapeHtml(s) {
    return s.replace(/&(?![a-zA-Z]+;|#\d+;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function cleanField(raw, opts) {
    let s = String(raw == null ? "" : raw).replace(/\r/g, "").trim();
    if (!s) return "";
    // Strip wrapping quotes from CSV-ish output.
    if (s.length > 1 && /^["“«].*["”»]$/s.test(s)) s = s.slice(1, -1).trim();

    // 1. Protect math so Markdown and HTML escaping don't touch it.
    const math = [];
    const keep = (open, body, close) => { math.push(open + body + close); return "\u0000M" + (math.length - 1) + "\u0000"; };
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, b) => keep("\\[", b, "\\]"));
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, b) => keep("\\(", b, "\\)"));
    if (opts.math !== false) {
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, b) => keep("\\[", b.trim(), "\\]"));
      s = s.replace(/(^|[^\\$\w])\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?![\w$])/g, (m, pre, b) => pre + keep("\\(", b, "\\)"));
      s = s.replace(/(^|[^\\$\w])\$([^\s$])\$(?![\w$])/g, (m, pre, b) => pre + keep("\\(", b, "\\)"));
    }

    // 2. Protect cloze markers ({{c1::…}}) from Markdown, keep their content cleanable.
    // 3. Escape HTML, then restore a small whitelist of formatting tags the AI may have used.
    s = escapeHtml(s).replace(SAFE_TAGS, (m, slash, tag, selfClose) => "<" + slash + tag.toLowerCase() + (selfClose.trim() ? " /" : "") + ">");

    // 4. Markdown → HTML.
    if (opts.markdown !== false) {
      s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+?)__/g, "<b>$1</b>");
      s = s.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\w)/g, "$1<i>$2</i>");
      s = s.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, "$1<i>$2</i>");
      s = s.replace(/^\s*[-*•]\s+/gm, "• ");
      s = s.replace(/^#{1,6}\s+/gm, "");
    }

    // 5. Newlines → <br>.
    s = s.replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>");

    // 6. Restore math (escaped for HTML, which Anki's MathJax reads as text).
    s = s.replace(/\u0000M(\d+)\u0000/g, (m, i) => escapeHtml(math[+i]));
    return s.trim();
  }

  function stripListMarker(s) {
    return s.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+|#\d+\s*[:.)-]?\s*)/, "");
  }

  // ---------- delimited text ----------

  function parseDelimited(text, d) {
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
        } else cur += ch;
      } else if (ch === '"' && cur.trim() === "") { q = true; cur = ""; }
      else if (text.startsWith(d, i)) { row.push(cur); cur = ""; i += d.length - 1; }
      else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    row.push(cur); rows.push(row);
    return rows.filter(r => r.some(c => c.trim() !== ""));
  }

  function looksLikeHeader(cells) {
    const words = cells.map(c => c.replace(/[*_`]/g, "").trim().toLowerCase()).filter(Boolean);
    return words.length > 0 && words.every(w => HEADER_WORDS.has(w));
  }

  function rowsToCards(rows, opts) {
    if (!rows.length) return [];
    let tagCol = -1;
    if (looksLikeHeader(rows[0])) {
      const head = rows[0].map(c => c.replace(/[*_`]/g, "").trim().toLowerCase());
      tagCol = head.findIndex(h => TAG_LABELS.includes(h));
      rows = rows.slice(1);
    }
    return rows.map(r => {
      const cells = r.map(c => c.trim());
      const front = stripListMarker(cells[0] || "");
      const back = cells.slice(1).filter((c, i) => i + 1 !== tagCol).join("\n");
      const tags = tagCol >= 0 && cells[tagCol] ? cells[tagCol].split(/[\s,;]+/) : [];
      return { front: front, back: back, tags: tags };
    });
  }

  // ---------- format detectors ----------

  function tryJson(text) {
    const t = text.trim();
    if (!/^[\[{]/.test(t)) return null;
    let data;
    try { data = JSON.parse(t); } catch (e) { return null; }
    if (!Array.isArray(data)) {
      const arr = Object.values(data).find(v => Array.isArray(v));
      if (!arr) return null;
      data = arr;
    }
    const pick = (o, keys) => { for (const k of Object.keys(o)) if (keys.includes(k.toLowerCase())) return o[k]; return undefined; };
    const out = [];
    for (const o of data) {
      if (typeof o === "string") { out.push({ front: o, back: "" }); continue; }
      if (Array.isArray(o)) { out.push({ front: String(o[0] || ""), back: String(o[1] || "") }); continue; }
      if (!o || typeof o !== "object") continue;
      const front = pick(o, FRONT_LABELS.concat(["text", "cloze", "texte", "recto"]));
      const back = pick(o, BACK_LABELS.concat(["extra", "back extra", "explanation", "explication"]));
      let tags = pick(o, TAG_LABELS);
      if (typeof tags === "string") tags = tags.split(/[\s,;]+/);
      if (front == null) continue;
      out.push({ front: String(front), back: back == null ? "" : String(back), tags: Array.isArray(tags) ? tags : [] });
    }
    return out.length ? { format: "json", cards: out } : null;
  }

  function tryTable(lines) {
    const tableLines = lines.filter(l => /^\s*\|.*\|\s*$/.test(l));
    if (tableLines.length < 2 || tableLines.length < lines.filter(l => l.trim()).length * 0.5) return null;
    const rows = tableLines
      .filter(l => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l))
      .map(l => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, "|").trim()));
    // A table whose first column is just a row number: drop that column.
    if (rows.length > 1 && rows.slice(1).every(r => /^\d+$/.test(r[0]))) rows.forEach(r => r.shift());
    return { format: "table", cards: rowsToCards(rows) };
  }

  function tryQA(lines) {
    const fronts = lines.filter(l => FRONT_RE.test(l)).length;
    const backs = lines.filter(l => BACK_RE.test(l)).length;
    if (fronts < 1 || backs < 1 || Math.abs(fronts - backs) > Math.max(1, fronts * 0.3)) return null;
    const cards = [];
    let cur = null, target = null;
    const flush = () => { if (cur && cur.front.trim()) cards.push(cur); cur = null; target = null; };
    for (const line of lines) {
      let m;
      if (/\{\{c\d+::/.test(line) && !FRONT_RE.test(line) && !BACK_RE.test(line) && (!cur || target === "back")) {
        // A stand-alone cloze line between Q/A cards becomes its own cloze card.
        flush();
        cards.push({ front: stripListMarker(line.trim()), back: "", tags: [] });
        continue;
      }
      if ((m = line.match(FRONT_RE)) && !(target === "back" && BACK_RE.test(line))) {
        flush();
        cur = { front: m[2], back: "", tags: [] };
        target = "front";
      } else if (cur && (m = line.match(BACK_RE))) {
        cur.back = m[2];
        target = "back";
      } else if (cur && (m = line.match(TAG_RE))) {
        cur.tags = m[2].replace(/[*_`]/g, "").split(/[\s,;]+/).filter(Boolean);
      } else if (cur && target) {
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) continue;
        cur[target] += "\n" + line;
      }
    }
    flush();
    cards.forEach(c => { c.front = c.front.trim(); c.back = c.back.replace(/\s+$/, "").replace(/^\n+/, ""); });
    return cards.length ? { format: "qa", cards: cards } : null;
  }

  function tryDelimited(text, lines) {
    const nonEmpty = lines.filter(l => l.trim());
    if (!nonEmpty.length) return null;
    const candidates = [
      { d: "\t", name: "tab" },
      { d: "::", name: "double-colon", skipIf: /\{\{c\d+::/ },
      { d: ";", name: "semicolon" },
      { d: "|", name: "pipe" },
      { d: ",", name: "csv" }
    ];
    for (const c of candidates) {
      const hits = nonEmpty.filter(l => l.includes(c.d) && !(c.skipIf && c.skipIf.test(l))).length;
      const need = c.d === "," ? 0.9 : 0.7;
      if (hits / nonEmpty.length < need) continue;
      const rows = parseDelimited(text, c.d);
      if (c.d === ",") {
        // Commas are common in prose: only accept a consistent column count.
        const counts = rows.map(r => r.length);
        const mode = counts.sort((a, b) => counts.filter(v => v === a).length - counts.filter(v => v === b).length).pop();
        if (mode < 2 || rows.filter(r => r.length === mode).length / rows.length < 0.85) continue;
      }
      if (rows.every(r => r.length >= 2) || rows.filter(r => r.length >= 2).length / rows.length >= 0.8) {
        return { format: c.name, cards: rowsToCards(rows.filter(r => r.length >= 2)) };
      }
    }
    return null;
  }

  function tryCloze(lines) {
    const clozeLines = lines.filter(l => /\{\{c\d+::/.test(l));
    if (!clozeLines.length || clozeLines.length < lines.filter(l => l.trim()).length * 0.5) return null;
    const cards = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      if (/\{\{c\d+::/.test(l)) cards.push({ front: stripListMarker(l.trim()), back: "", tags: [] });
      else if (cards.length) cards[cards.length - 1].back += (cards[cards.length - 1].back ? "\n" : "") + l.trim();
    }
    return { format: "cloze", cards: cards };
  }

  function tryGlossary(lines) {
    const nonEmpty = lines.filter(l => l.trim());
    const dash = /^(.{1,160}?)\s+[—–-]{1,2}\s+(.+)$/;
    const colon = /^([^:]{1,100}?)\s*:\s+(.+)$/;
    for (const re of [dash, colon]) {
      const hits = nonEmpty.filter(l => re.test(stripListMarker(l)));
      if (hits.length >= 2 && hits.length / nonEmpty.length >= 0.7) {
        return {
          format: re === dash ? "glossary-dash" : "glossary-colon",
          cards: hits.map(l => { const m = stripListMarker(l).match(re); return { front: m[1].replace(/^\*\*|\*\*$/g, ""), back: m[2], tags: [] }; })
        };
      }
    }
    return null;
  }

  function tryParagraphs(text) {
    const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    const pairs = blocks.filter(b => b.split("\n").length >= 2);
    if (pairs.length < 1 || pairs.length / blocks.length < 0.7) return null;
    return {
      format: "paragraphs",
      cards: pairs.map(b => { const ls = b.split("\n"); return { front: stripListMarker(ls[0]), back: ls.slice(1).join("\n"), tags: [] }; })
    };
  }

  // ---------- main ----------

  function normalize(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/ /g, " ")
      .replace(/^\s*```[\w-]*\s*$/gm, "")
      .replace(/^\s*(?:here (?:are|is)|voici|aquí|aqui|hier sind|ecco)\b[^\n]*:\s*$/gim, "")
      .trim();
  }

  function parse(text, opts) {
    opts = opts || {};
    const t = normalize(text);
    if (!t) return { format: "empty", cards: [] };
    const lines = t.split("\n");
    const result =
      tryJson(t) ||
      tryTable(lines) ||
      tryQA(lines) ||
      tryCloze(lines) ||
      tryDelimited(t, lines) ||
      tryGlossary(lines) ||
      tryParagraphs(t) ||
      { format: "unknown", cards: [] };

    const seen = new Set();
    const cards = [];
    for (const c of result.cards) {
      const frontRaw = String(c.front || "").trim();
      if (!frontRaw) continue;
      const isCloze = /\{\{c\d+::/.test(frontRaw);
      const front = cleanField(frontRaw, opts);
      const back = cleanField(c.back || "", opts);
      if (!isCloze && !back) continue;
      const key = front.replace(/<[^>]+>/g, "").toLowerCase().replace(/\s+/g, " ").trim();
      if (opts.dedupe !== false && seen.has(key)) continue;
      seen.add(key);
      const tags = (c.tags || []).map(x => String(x).replace(/^#/, "").trim()).filter(Boolean);
      cards.push({ type: isCloze ? "cloze" : "basic", front: front, back: back, tags: tags });
    }
    return { format: result.format, cards: cards };
  }

  const api = { parse: parse, cleanField: cleanField };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CardParser = api;
})(typeof self !== "undefined" ? self : this);
