(function () {
  "use strict";
  const C = window.SITE_CONFIG;
  const $ = id => document.getElementById(id);

  $("title").textContent = C.title;
  $("subtitle").textContent = C.subtitle;

  let headers = [], rows = [], info = null, cols = [];
  let sortCol = "#", sortDir = -1;

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function pillClass(v) {
    const s = v.toLowerCase();
    if (/\b(no|not|invalid|fail|failed|false|pending|incomplete|error)\b/.test(s)) return "bad";
    if (/\b(yes|good|done|complete|completed|redeemed|valid|true|ok|active)\b/.test(s)) return "good";
    return "warn";
  }

  function cell(h, v) {
    const t = info.types[h];
    if (v === "" || v == null) return '<td class="' + (t === "number" ? "num" : "") + '"><span style="color:var(--muted)">–</span></td>';
    if (h === info.nameCol) return '<td class="name">' + esc(v) + "</td>";
    if (t === "number") return '<td class="num">' + esc(v) + "</td>";
    if (t === "url") {
      if (!/^https?:\/\//i.test(v)) return "<td>" + esc(v) + "</td>";
      return '<td><a href="' + esc(v) + '" target="_blank" rel="noopener noreferrer">Open ↗</a></td>';
    }
    if (t === "status") return '<td><span class="pill ' + pillClass(v) + '">' + esc(v) + "</span></td>";
    if (t === "long") {
      const parts = v.split(/\s*\|\s*/).filter(Boolean);
      const label = parts.length > 1 ? "View " + parts.length : "View";
      return '<td><details><summary>' + label + '</summary><div class="long">' +
        (parts.length > 1 ? parts.map(esc).join("<br>") : esc(v)) + "</div></details></td>";
    }
    return "<td>" + esc(v) + "</td>";
  }

  function computeRanks() {
    if (!info.scoreCol) { rows.forEach((r, i) => { r.__rank = i + 1; }); return; }
    const sorted = rows.slice().sort((a, b) => (CsvCore.num(b[info.scoreCol]) || 0) - (CsvCore.num(a[info.scoreCol]) || 0));
    let prev = null, rank = 0;
    sorted.forEach((r, i) => {
      const s = CsvCore.num(r[info.scoreCol]) || 0;
      if (s !== prev) { rank = i + 1; prev = s; }
      r.__rank = rank;
    });
  }

  function compare(a, b) {
    if (sortCol === "#") return (a.__rank - b.__rank) * -sortDir;
    const t = info.types[sortCol];
    const x = a[sortCol], y = b[sortCol];
    if (t === "number") return ((CsvCore.num(x) || 0) - (CsvCore.num(y) || 0)) * sortDir;
    return String(x).localeCompare(String(y), undefined, { sensitivity: "base", numeric: true }) * sortDir;
  }

  function renderHead() {
    $("head").innerHTML = ["#"].concat(cols).map(h => {
      const isNum = h === "#" || info.types[h] === "number";
      const on = h === sortCol;
      const arrow = on ? (sortDir === (h === "#" ? -1 : 1) ? "▲" : "▼") : "↕";
      return '<th data-col="' + esc(h) + '" class="' + (isNum ? "num " : "") + (on ? "sorted" : "") + '">' +
        esc(h) + '<span class="arrow">' + arrow + "</span></th>";
    }).join("");
  }

  function render() {
    const q = $("q").value.trim().toLowerCase();
    const list = rows
      .filter(r => !q || cols.some(h => String(r[h]).toLowerCase().includes(q)))
      .sort(compare);
    renderHead();
    if (!list.length) {
      $("body").innerHTML = '<tr><td colspan="' + (cols.length + 1) + '" class="empty">No participant matches “' + esc(q) + '”.</td></tr>';
    } else {
      $("body").innerHTML = list.map(r => {
        const top = info.scoreCol && r.__rank <= 3 && (CsvCore.num(r[info.scoreCol]) || 0) > 0;
        const rankHtml = top ? '<span class="medal m' + r.__rank + '">' + r.__rank + "</span>" : r.__rank;
        return "<tr>" + '<td class="rank' + (top ? " top" : "") + '">' + rankHtml + "</td>" +
          cols.map(h => cell(h, r[h])).join("") + "</tr>";
      }).join("");
    }
    $("count").textContent = q ? list.length + " of " + rows.length + " shown" : rows.length + " participants";
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "–";
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }

  function shortLabel(h) {
    return h.replace(/^#\s*of\s*/i, "").replace(/\bnumber of\b/i, "").trim();
  }

  function renderStats(meta) {
    $("s-count").textContent = rows.length;
    if (info.scoreCol) {
      const nums = rows.map(r => CsvCore.num(r[info.scoreCol]) || 0);
      $("s-total-label").textContent = "Total " + shortLabel(info.scoreCol);
      $("s-total").textContent = nums.reduce((a, b) => a + b, 0).toLocaleString();
      $("s-active-label").textContent = "Started";
      $("s-active").textContent = nums.filter(n => n > 0).length;
    }
    $("s-updated").textContent = meta && meta.updatedAt ? fmtDate(meta.updatedAt) : "–";
  }

  async function load() {
    const bust = "?t=" + Date.now();
    try {
      const [csvRes, metaRes] = await Promise.all([
        fetch(C.dataPath + bust, { cache: "no-store" }),
        fetch(C.metaPath + bust, { cache: "no-store" }).catch(() => null)
      ]);
      if (!csvRes.ok) throw new Error("No data has been published yet.");
      const parsed = CsvCore.parse(await csvRes.text());
      headers = parsed.headers;
      rows = parsed.rows;
      info = CsvCore.describe(headers, rows);
      cols = headers.filter(h => !info.sensitive.includes(h));
      // Name first, then the counts people care about, then statuses, lists and links.
      const order = { number: 1, status: 2, text: 3, long: 4, url: 5 };
      cols = cols.filter(h => h !== info.nameCol)
        .map((h, i) => ({ h, i }))
        .sort((a, b) => (order[info.types[a.h]] - order[info.types[b.h]]) || (a.i - b.i))
        .map(x => x.h);
      if (info.nameCol) cols.unshift(info.nameCol);
      let meta = null;
      if (metaRes && metaRes.ok) { try { meta = await metaRes.json(); } catch (e) { meta = null; } }
      $("sample-note").hidden = !(meta && meta.sample);
      computeRanks();
      renderStats(meta);
      $("status").hidden = true;
      $("table").hidden = false;
      render();
    } catch (e) {
      $("status").textContent = e.message || "Could not load data.";
    }
  }

  $("head").addEventListener("click", e => {
    const th = e.target.closest("th");
    if (!th) return;
    const col = th.dataset.col;
    if (col === sortCol) sortDir = -sortDir;
    else { sortCol = col; sortDir = (col === "#") ? -1 : (info.types[col] === "number" ? -1 : 1); }
    render();
  });
  $("q").addEventListener("input", render);

  load();
})();
