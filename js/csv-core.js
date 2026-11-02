// Shared CSV logic for the public page and the admin page.
// Works in the browser (window.CsvCore) and in Node (module.exports) for testing.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("papaparse"));
  } else {
    root.CsvCore = factory(root.Papa);
  }
})(typeof self !== "undefined" ? self : this, function (Papa) {
  "use strict";

  const SENSITIVE = /(e-?mail|phone|mobile|contact\s*no|whatsapp|password|aadhaar|aadhar)/i;
  const URL_COL = /(url|link|profile)/i;
  const NAME_COL = /name/i;
  const NOT_NAME = /(badge|game|lab|course|skill|arcade|college|institute)/i;

  function cleanHeader(h, i) {
    const s = String(h == null ? "" : h).replace(/^﻿/, "").replace(/\s+/g, " ").trim();
    return s || "Column " + (i + 1);
  }

  // Parse one CSV text into { headers, rows } with clean, unique headers and no blank rows.
  function parse(text) {
    if (typeof text !== "string") throw new Error("File could not be read as text.");
    text = text.replace(/^﻿/, "");
    if (!text.trim()) throw new Error("The file is empty.");

    const res = Papa.parse(text, { skipEmptyLines: "greedy" });
    const fatal = (res.errors || []).filter(e => e.type === "Quotes");
    if (fatal.length) {
      throw new Error("Broken quotes near row " + (fatal[0].row + 1) + ". Re-export the CSV and try again.");
    }
    const grid = res.data;
    if (!grid.length) throw new Error("The file has no rows.");

    const seen = {};
    const headers = grid[0].map((h, i) => {
      let name = cleanHeader(h, i);
      if (seen[name]) { seen[name]++; name = name + " (" + seen[name] + ")"; } else seen[name] = 1;
      return name;
    });
    if (headers.length < 2) throw new Error("Only one column found. Is this really a comma-separated file?");

    const rows = [];
    for (let r = 1; r < grid.length; r++) {
      const line = grid[r];
      if (line.every(v => String(v).trim() === "")) continue;
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(line[i] == null ? "" : line[i]).trim(); });
      rows.push(obj);
    }
    if (!rows.length) throw new Error("The file has headers but no participant rows.");
    return { headers, rows };
  }

  function findCol(headers, test) {
    return headers.find(test) || null;
  }

  function isNumeric(v) {
    return v !== "" && /^-?\d+(\.\d+)?$/.test(String(v).replace(/,/g, ""));
  }
  function num(v) { return isNumeric(v) ? parseFloat(String(v).replace(/,/g, "")) : NaN; }

  // Work out what each column is so the page can display it sensibly.
  function describe(headers, rows) {
    const emailCol = findCol(headers, h => /e-?mail/i.test(h));
    const nameCol =
      findCol(headers, h => /^(user\s*name|name|full\s*name|participant\s*name|student\s*name)$/i.test(h)) ||
      findCol(headers, h => NAME_COL.test(h) && !NOT_NAME.test(h) && !SENSITIVE.test(h)) ||
      headers.find(h => !SENSITIVE.test(h));
    const sensitive = headers.filter(h => SENSITIVE.test(h));
    const types = {};
    headers.forEach(h => {
      const vals = rows.map(r => r[h]).filter(v => v !== "");
      const allNum = vals.length > 0 && vals.every(isNumeric);
      const looksUrl = vals.length > 0 && vals.filter(v => /^https?:\/\//i.test(v)).length >= vals.length * 0.6;
      const avgLen = vals.length ? vals.reduce((a, v) => a + v.length, 0) / vals.length : 0;
      const distinct = new Set(vals.map(v => v.toLowerCase())).size;
      if (allNum) types[h] = "number";
      else if (looksUrl || (URL_COL.test(h) && vals.some(v => /^https?:\/\//i.test(v)))) types[h] = "url";
      else if (avgLen > 45) types[h] = "long";
      else if (distinct > 0 && distinct <= 4 && avgLen < 25 && h !== nameCol) types[h] = "status";
      else types[h] = "text";
    });
    const numberCols = headers.filter(h => types[h] === "number");
    const scoreCol =
      numberCols.find(h => /(total|completed|badge|score|points)/i.test(h)) || numberCols[0] || null;
    return { nameCol, emailCol, sensitive, types, numberCols, scoreCol };
  }

  function keyFor(row, d) {
    const urlCol = Object.keys(d.types).find(h => d.types[h] === "url" && /profile/i.test(h));
    const parts = [
      d.emailCol && row[d.emailCol],
      urlCol && row[urlCol],
      d.nameCol && row[d.nameCol]
    ];
    const k = parts.find(v => v && String(v).trim());
    return k ? String(k).trim().toLowerCase().replace(/\/+$/, "") : null;
  }

  // Combine one or more parsed files. Later files win for the same participant.
  // Returns { headers, rows, stats }.
  function merge(files) {
    if (!files.length) throw new Error("No files to merge.");
    const headers = [];
    files.forEach(f => f.headers.forEach(h => { if (!headers.includes(h)) headers.push(h); }));
    const all = files.flatMap(f => f.rows.map(r => {
      const o = {};
      headers.forEach(h => { o[h] = r[h] == null ? "" : r[h]; });
      return o;
    }));
    const d = describe(headers, all);
    const byKey = new Map();
    let unkeyed = 0, duplicates = 0;
    const order = [];
    all.forEach(r => {
      const k = keyFor(r, d);
      if (!k) { unkeyed++; order.push({ row: r }); return; }
      if (byKey.has(k)) {
        duplicates++;
        const prev = byKey.get(k);
        headers.forEach(h => { if (r[h] !== "") prev.row[h] = r[h]; });
      } else {
        const entry = { row: r };
        byKey.set(k, entry);
        order.push(entry);
      }
    });
    const rows = order.map(e => e.row);
    return { headers, rows, stats: { input: all.length, output: rows.length, duplicates, unkeyed } };
  }

  // Drop personal columns (emails, phone numbers) before anything is published.
  function stripSensitive(headers, rows) {
    const keep = headers.filter(h => !SENSITIVE.test(h));
    const removed = headers.filter(h => SENSITIVE.test(h));
    return {
      headers: keep,
      rows: rows.map(r => { const o = {}; keep.forEach(h => { o[h] = r[h]; }); return o; }),
      removed
    };
  }

  function toCsv(headers, rows) {
    return Papa.unparse({ fields: headers, data: rows.map(r => headers.map(h => r[h] == null ? "" : r[h])) }, { newline: "\n" }) + "\n";
  }

  return { parse, describe, merge, stripSensitive, toCsv, isNumeric, num, SENSITIVE };
});
