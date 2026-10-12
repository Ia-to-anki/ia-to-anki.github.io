/* app.js — page logic for AI to Anki. Strings come from window.I18N, set by each language page. */
(function () {
  "use strict";
  const T = window.I18N;
  const BASE = window.ASSET_BASE || "assets/";
  const $ = id => document.getElementById(id);
  const input = $("input"), deck = $("deck"), tags = $("tags"), rev = $("reversed"), math = $("math");
  const list = $("cards"), status = $("status"), btn = $("download"), msg = $("msg");

  let parsed = { format: "empty", cards: [] };
  let removed = new Set();
  let sqlPromise = null;

  const store = {
    get(k) { try { return localStorage.getItem("ai2anki:" + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("ai2anki:" + k, v); } catch (e) {} }
  };

  function fmt(s, vars) { return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)); }

  function previewHtml(html) {
    // Field HTML is already escaped by the parser (only plain formatting tags survive).
    return html.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (m, n, a) => '<span class="cl">[' + a + "]<sub>" + n + "</sub></span>");
  }

  function extraTags() {
    return tags.value.split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
  }

  function activeCards() {
    return parsed.cards.filter((c, i) => !removed.has(i));
  }

  function render() {
    const cards = activeCards();
    const n = cards.length;
    if (!parsed.cards.length) {
      list.innerHTML = '<div class="empty">' + (input.value.trim() ? T.unknown : T.emptyPreview) + "</div>";
      status.textContent = "";
    } else {
      list.innerHTML = parsed.cards.map((c, i) => removed.has(i) ? "" :
        '<div class="icard"><span class="kind">' + (c.type === "cloze" ? "cloze" : "") + "</span>" +
        '<button type="button" class="x" data-i="' + i + '" aria-label="' + T.remove + '" title="' + T.remove + '">×</button>' +
        '<div class="f">' + previewHtml(c.front) + "</div>" +
        (c.back ? '<div class="b">' + previewHtml(c.back) + "</div>" : "") +
        "</div>").join("");
      const label = T.formats[parsed.format] || parsed.format;
      status.innerHTML = fmt(T.status, { n: "<b>" + n + "</b>", format: label });
    }
    btn.disabled = n === 0;
    btn.textContent = n ? fmt(T.download, { n: n }) : T.downloadEmpty;
  }

  let timer = null;
  function update() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      parsed = window.CardParser.parse(input.value, { math: math.checked });
      removed = new Set();
      msg.textContent = "";
      msg.className = "msg";
      render();
    }, 150);
  }

  function loadSql() {
    if (!sqlPromise) {
      sqlPromise = window.initSqlJs({ locateFile: f => BASE + "vendor/" + f });
    }
    return sqlPromise;
  }

  async function sha1(s) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function fileName(name) {
    const base = name.replace(/::/g, " - ").replace(/[\\/:*?"<>|]+/g, "").trim() || "AI to Anki";
    return base.slice(0, 80) + ".apkg";
  }

  async function download() {
    const cards = activeCards();
    if (!cards.length) return;
    btn.disabled = true;
    btn.textContent = T.building;
    msg.className = "msg";
    msg.textContent = "";
    try {
      const SQL = await loadSql();
      const extra = extraTags();
      const deckName = deck.value.trim() || T.deckDefault;
      const out = await window.Apkg.buildApkg({
        SQL: SQL, JSZip: window.JSZip, sha1: sha1, deckName: deckName, reversed: rev.checked,
        cards: cards.map(c => ({ type: c.type, front: c.front, back: c.back, tags: c.tags.concat(extra) }))
      });
      const blob = new Blob([out.bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(deckName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      msg.className = "msg ok";
      msg.textContent = fmt(T.done, { n: out.cards });
    } catch (e) {
      console.error(e);
      msg.className = "msg err";
      msg.textContent = T.error;
    } finally {
      render();
    }
  }

  // Events
  input.addEventListener("input", update);
  math.addEventListener("change", () => { store.set("math", math.checked ? "1" : "0"); update(); });
  rev.addEventListener("change", () => store.set("rev", rev.checked ? "1" : "0"));
  deck.addEventListener("change", () => store.set("deck", deck.value));
  tags.addEventListener("change", () => store.set("tags", tags.value));
  list.addEventListener("click", e => {
    const b = e.target.closest(".x");
    if (!b) return;
    removed.add(+b.dataset.i);
    render();
  });
  btn.addEventListener("click", download);
  $("example").addEventListener("click", () => { input.value = T.example; update(); input.focus(); });
  $("clear").addEventListener("click", () => { input.value = ""; update(); input.focus(); });
  document.querySelectorAll("[data-copy]").forEach(b => {
    b.addEventListener("click", () => {
      const src = document.getElementById(b.dataset.copy);
      const text = src.textContent;
      const ok = () => { b.textContent = T.copied; setTimeout(() => { b.textContent = T.copy; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, () => selectText(src));
      } else selectText(src);
    });
  });
  function selectText(el) {
    const r = document.createRange(); r.selectNodeContents(el);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  // Restore preferences
  const d = store.get("deck"); if (d) deck.value = d;
  const tg = store.get("tags"); if (tg) tags.value = tg;
  if (store.get("rev") === "1") rev.checked = true;
  if (store.get("math") === "0") math.checked = false;

  // Warm up the SQLite engine once the page is idle.
  (window.requestIdleCallback || (fn => setTimeout(fn, 1200)))(() => { loadSql().catch(() => {}); });
  update();
})();
