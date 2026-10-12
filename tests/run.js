// Run with:  node tests/run.js   (no npm install needed: uses the vendored libraries)
"use strict";
const path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const R = path.join(__dirname, "..");
const P = require(path.join(R, "assets/parse.js"));
const A = require(path.join(R, "assets/apkg.js"));
const initSqlJs = require(path.join(R, "assets/vendor/sql-wasm.js"));
const JSZip = require(path.join(R, "assets/vendor/jszip.min.js"));

let failed = 0;
function check(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); }
}
const parse = t => P.parse(t, {});

check("Q/A with bold labels, math and lists", () => {
  const r = parse("**Q1:** Kinetic energy?\n**A1:** $E_k = \\frac{1}{2}mv^2$\n\n**Q2:** Layers?\n**A2:**\n- One\n- Two\nTags: bio skin");
  assert.strictEqual(r.format, "qa");
  assert.strictEqual(r.cards.length, 2);
  assert.strictEqual(r.cards[0].back, "\\(E_k = \\frac{1}{2}mv^2\\)");
  assert.strictEqual(r.cards[1].back, "• One<br>• Two");
  assert.deepStrictEqual(r.cards[1].tags, ["bio", "skin"]);
});
check("Q/A in French, German, Spanish, Portuguese, Italian", () => {
  for (const [q, a] of [["Question", "Réponse"], ["Frage", "Antwort"], ["Pregunta", "Respuesta"], ["Pergunta", "Resposta"], ["Domanda", "Risposta"]]) {
    const r = parse(q + " : un ?\n" + a + " : deux\n\n" + q + ": trois ?\n" + a + ": quatre");
    assert.strictEqual(r.cards.length, 2, q);
  }
});
check("Stand-alone cloze line between Q/A cards", () => {
  const r = parse("Q: a?\nA: b\n\n{{c1::Paris}} is in {{c2::France}}.\n\nQ: c?\nA: d");
  assert.strictEqual(r.cards.length, 3);
  assert.strictEqual(r.cards[1].type, "cloze");
});
check("Markdown table with header and number column", () => {
  const r = parse("| # | Question | Answer |\n|---|---|---|\n| 1 | ATP? | Energy |\n| 2 | DNA? | Genes |");
  assert.strictEqual(r.format, "table");
  assert.deepStrictEqual(r.cards.map(c => c.front), ["ATP?", "DNA?"]);
});
check("Semicolon CSV with quotes and tag column", () => {
  const r = parse('Front;Back;Tags\n"Hello; world";Bonjour;greet\nThanks;Merci;greet polite');
  assert.strictEqual(r.cards[0].front, "Hello; world");
  assert.deepStrictEqual(r.cards[1].tags, ["greet", "polite"]);
});
check("Tab-separated rows", () => assert.strictEqual(parse("dog\tchien\ncat\tchat").cards.length, 2));
check("JSON array inside a code fence", () => {
  const r = parse('```json\n[{"question":"2+2?","answer":"4"}]\n```');
  assert.strictEqual(r.format, "json");
  assert.strictEqual(r.cards[0].back, "4");
});
check("Glossary with dashes", () => assert.strictEqual(parse("1. **A** — first\n2. **B** — second").cards[1].front, "B"));
check("Prices are not turned into math", () => {
  const r = parse("Q: Cost?\nA: It costs $5 and $10.");
  assert.strictEqual(r.cards[0].back, "It costs $5 and $10.");
});
check("HTML special characters are escaped", () => assert.strictEqual(parse("Q: x < 5?\nA: yes").cards[0].front, "x &lt; 5?"));
check("Duplicates are removed", () => assert.strictEqual(parse("Q: a\nA: b\n\nQ: a\nA: c").cards.length, 1));
check("Unstructured text gives no cards", () => assert.strictEqual(parse("just a sentence with nothing else").cards.length, 0));

(async () => {
  const SQL = await initSqlJs();
  const sha1 = async s => crypto.createHash("sha1").update(s, "utf8").digest("hex");
  const cards = parse("Q: a?\nA: b\n\n{{c1::x}} and {{c2::y}}").cards;
  const out = await A.buildApkg({ SQL, JSZip, sha1, deckName: "Test", reversed: true, cards });
  check("apkg builds with the right card count", () => assert.strictEqual(out.cards, 4));
  const zip = await JSZip.loadAsync(out.bytes);
  const db = new SQL.Database(await zip.file("collection.anki2").async("uint8array"));
  check("apkg contains notes and cards", () => {
    assert.strictEqual(db.exec("select count(*) from notes")[0].values[0][0], 2);
    assert.strictEqual(db.exec("select count(*) from cards")[0].values[0][0], 4);
  });
  console.log(failed ? "\n" + failed + " test(s) failed" : "\nAll tests passed");
  process.exit(failed ? 1 : 0);
})();
