(function () {
  "use strict";
  const C = window.SITE_CONFIG;
  const $ = id => document.getElementById(id);
  const PAGE = 40;

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = v => { const n = CsvCore.num(v); return isNaN(n) ? 0 : n; };

  let rows = [], info = null, M = null;
  let filter = "all", sortBy = "rank", shown = PAGE;

  // ---------- understand the columns ----------
  function shortLabel(h) {
    return h
      .replace(/google cloud skills boost/ig, "")
      .replace(/^(#|no\.?|number)\s*of\s*/i, "")
      .replace(/\b(names?\s+of\s+)/ig, "")
      .replace(/\b(status|redemption|completed|count)\b/ig, "")
      .replace(/\s{2,}/g, " ").replace(/^[\s\-–:&]+|[\s\-–:&]+$/g, "").trim() || h;
  }

  function model(headers, data) {
    const d = CsvCore.describe(headers, data);
    const serial = /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|#|rank|index|id|no\.?)$/i;
    const visible = headers.filter(h => !d.sensitive.includes(h));
    const metrics = visible.filter(h => d.types[h] === "number" && !serial.test(h));
    const score = metrics.find(h => /(badge|total|score|points|completed)/i.test(h)) || metrics[0] || null;
    if (score) metrics.splice(metrics.indexOf(score), 1), metrics.unshift(score);
    const urlCol = visible.find(h => d.types[h] === "url" && /profile/i.test(h)) || visible.find(h => d.types[h] === "url") || null;
    const listCols = visible.filter(h => d.types[h] === "long" ||
      (d.types[h] === "text" && h !== d.nameCol && data.filter(r => / \| /.test(r[h])).length >= Math.max(1, data.length * 0.15)));
    const statusCols = visible.filter(h => d.types[h] === "status");
    const completeCol = statusCols.find(h => /\ball\b/i.test(h) && /complet/i.test(h)) || null;
    const otherCols = visible.filter(h => h !== d.nameCol && !metrics.includes(h) && h !== urlCol &&
      !listCols.includes(h) && !statusCols.includes(h) && !serial.test(h));
    const max = {};
    metrics.forEach(h => {
      const t = C.targets && C.targets[h];
      max[h] = t || Math.max(1, ...data.map(r => num(r[h])));
    });
    return { d, nameCol: d.nameCol, score, metrics: metrics.slice(0, 4), urlCol, listCols, statusCols, completeCol, otherCols, max };
  }

  const isYes = v => /^(yes|y|true|done|completed?|1)$/i.test(String(v).trim());
  function tone(v) {
    const s = String(v).toLowerCase();
    if (/\b(no|not|invalid|fail|failed|false|pending|incomplete|error)\b/.test(s)) return "bad";
    if (/\b(yes|good|done|complete|completed|redeemed|valid|true|ok|active)\b/.test(s)) return "good";
    return "warn";
  }

  function rank() {
    const sorted = rows.slice().sort((a, b) => (M.score ? num(b[M.score]) - num(a[M.score]) : 0));
    let prev = null, r = 0;
    sorted.forEach((row, i) => {
      const s = M.score ? num(row[M.score]) : 0;
      if (s !== prev) { r = i + 1; prev = s; }
      row.__rank = r;
    });
  }

  function initials(name) {
    const p = String(name || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }

  function highlight(text, q) {
    const t = String(text);
    if (!q) return esc(t);
    const i = t.toLowerCase().indexOf(q);
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
  }

  // ---------- rendering ----------
  function renderStats(meta) {
    const total = rows.length;
    $("s1").textContent = total.toLocaleString();
    if (M.score) {
      const vals = rows.map(r => num(r[M.score]));
      $("s2").textContent = vals.reduce((a, b) => a + b, 0).toLocaleString();
      $("s2k").textContent = /badge/i.test(M.score) ? "Badges earned" : "Total " + shortLabel(M.score).toLowerCase();
      $("s3").textContent = vals.filter(v => v > 0).length.toLocaleString();
    }
    if (M.completeCol) {
      $("s4").textContent = rows.filter(r => isYes(r[M.completeCol])).length.toLocaleString();
      $("s4k").textContent = "Completed all";
    } else if (M.score) {
      $("s4").textContent = Math.max(0, ...rows.map(r => num(r[M.score]))).toLocaleString();
      $("s4k").textContent = "Top score";
    }
    let label = "Updated daily";
    if (meta && meta.updatedAt) {
      const d = new Date(meta.updatedAt), mins = (Date.now() - d) / 60000;
      if (!isNaN(d)) {
        label = mins < 1 ? "Updated just now" :
          mins < 60 ? "Updated " + Math.round(mins) + " min ago" :
          mins < 24 * 60 ? "Updated " + Math.round(mins / 60) + " h ago" :
          "Updated " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
      }
    }
    $("updated").textContent = label;
    $("sample-note").hidden = !(meta && meta.sample);
  }

  function renderPodium() {
    if (!M.score) return;
    const top = rows.filter(r => num(r[M.score]) > 0).sort((a, b) => a.__rank - b.__rank).slice(0, 3);
    if (top.length < 3) return;
    const unit = /badge/i.test(M.score) ? "badges" : shortLabel(M.score).toLowerCase();
    const cls = ["", "bg-gold", "bg-silver", "bg-bronze"];
    const order = [top[1], top[0], top[2]];
    const place = [2, 1, 3];
    $("podium").innerHTML = order.map((r, i) => {
      const p = place[i];
      const medal = Math.min(r.__rank, 3);
      return '<div class="pod p' + p + '">' +
        (p === 1 ? '<span class="crown" aria-hidden="true">👑</span>' : "") +
        '<div class="avatar ' + cls[medal] + '">' + esc(initials(r[M.nameCol])) +
        '<span class="medal ' + cls[medal] + '">' + r.__rank + "</span></div>" +
        '<div class="nm">' + esc(r[M.nameCol]) + "</div>" +
        '<div class="sc">' + num(r[M.score]) + '</div><div class="sl">' + esc(unit) + "</div></div>";
    }).join("");
    $("podium").hidden = false;
    $("pod-title").hidden = false;
  }

  function counts() {
    const c = { all: rows.length, started: 0, idle: 0, done: 0 };
    rows.forEach(r => {
      if (M.score && num(r[M.score]) > 0) c.started++; else c.idle++;
      if (M.completeCol && isYes(r[M.completeCol])) c.done++;
    });
    return c;
  }

  function renderChips() {
    const c = counts();
    const chips = [["all", "All", c.all]];
    if (M.score) chips.push(["started", "Started", c.started], ["idle", "Not started", c.idle]);
    if (M.completeCol) chips.push(["done", "Completed all", c.done]);
    $("chips").innerHTML = chips.map(([k, l, n]) =>
      '<button class="chip" type="button" data-f="' + k + '" aria-pressed="' + (filter === k) + '">' + l + " <b>" + n + "</b></button>"
    ).join("") +
      '<button class="chip sort" type="button" data-sort="1" aria-label="Change sort order">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>' +
      (sortBy === "rank" ? "By rank" : "A–Z") + "</button>";
  }

  function card(r, q) {
    const rk = r.__rank;
    const hasScore = M.score && num(r[M.score]) > 0;
    const rc = hasScore && rk <= 3 ? " r" + rk : "";
    const pills = [];
    if (M.completeCol && isYes(r[M.completeCol])) pills.push('<span class="pill good">✓ Completed all</span>');
    M.statusCols.filter(h => h !== M.completeCol && r[h]).forEach(h => {
      pills.push('<span class="pill ' + tone(r[h]) + '">' + esc(shortLabel(h)) + ": " + esc(r[h]) + "</span>");
    });
    const link = M.urlCol && /^https?:\/\//i.test(r[M.urlCol])
      ? '<a class="open" href="' + esc(r[M.urlCol]) + '" target="_blank" rel="noopener noreferrer" aria-label="Open profile of ' + esc(r[M.nameCol]) + '">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>'
      : "<span></span>";
    const metrics = M.metrics.map((h, i) => {
      const v = num(r[h]), mx = M.max[h];
      const pct = Math.max(0, Math.min(100, (v / mx) * 100));
      return '<div class="metric"><div class="top"><span class="lbl">' + esc(shortLabel(h)) + '</span><span class="val">' + v +
        ' <small>/ ' + mx + '</small></span></div><div class="bar"><i class="c' + (i + 1) + '" style="width:' + pct.toFixed(1) + '%"></i></div></div>';
    }).join("");
    const lists = M.listCols.map(h => {
      const items = String(r[h] || "").split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
      return items.length ? '<p class="sub-h">' + esc(shortLabel(h)) + '</p><div class="tags">' + items.map(t => '<span class="tag">' + esc(t) + "</span>").join("") + "</div>" : "";
    }).join("");
    const extra = M.otherCols.filter(h => r[h]).map(h => '<p class="sub-h">' + esc(h) + "</p><div>" + esc(r[h]) + "</div>").join("");
    const total = M.listCols.reduce((n, h) => n + String(r[h] || "").split("|").filter(s => s.trim()).length, 0);
    const details = (lists || extra)
      ? '<details><summary><svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
        (total ? "View completed (" + total + ")" : "More details") + "</summary>" + lists + extra + "</details>"
      : "";
    return '<li class="pc">' +
      '<div class="rank' + rc + '">' + rk + "</div>" +
      '<div class="who"><div class="nm">' + highlight(r[M.nameCol], q) + "</div>" + (pills.length ? '<div class="pills">' + pills.join("") + "</div>" : "") + "</div>" +
      link +
      (metrics ? '<div class="metrics">' + metrics + "</div>" : "") +
      details + "</li>";
  }

  function current() {
    const q = $("q").value.trim().toLowerCase();
    let list = rows.filter(r => {
      if (filter === "started" && !(num(r[M.score]) > 0)) return false;
      if (filter === "idle" && num(r[M.score]) > 0) return false;
      if (filter === "done" && !isYes(r[M.completeCol])) return false;
      if (!q) return true;
      return String(r[M.nameCol]).toLowerCase().includes(q) ||
        (M.urlCol && String(r[M.urlCol]).toLowerCase().includes(q));
    });
    list.sort(sortBy === "rank"
      ? (a, b) => a.__rank - b.__rank || String(a[M.nameCol]).localeCompare(String(b[M.nameCol]))
      : (a, b) => String(a[M.nameCol]).localeCompare(String(b[M.nameCol]), undefined, { sensitivity: "base" }));
    return { list, q };
  }

  function render() {
    const { list, q } = current();
    const page = list.slice(0, shown);
    $("list").innerHTML = page.map(r => card(r, q)).join("");
    $("empty").hidden = list.length > 0;
    if (!list.length) $("empty").innerHTML = q ? "No one named “" + esc(q) + "” yet.<br>Check the spelling, or try your first name only." : "Nobody in this group yet.";
    $("more").hidden = list.length <= shown;
    $("more-btn").textContent = "Show more (" + (list.length - shown) + " left)";
    $("result-line").textContent = q || filter !== "all"
      ? list.length + " of " + rows.length + " participants"
      : "Showing " + Math.min(shown, list.length) + " of " + rows.length + " participants";
    $("clear").hidden = !q;
  }

  // ---------- data ----------
  async function load() {
    const bust = "?t=" + Date.now();
    try {
      const [csvRes, metaRes] = await Promise.all([
        fetch(C.dataPath + bust, { cache: "no-store" }),
        fetch(C.metaPath + bust, { cache: "no-store" }).catch(() => null)
      ]);
      if (!csvRes.ok) throw new Error("No data has been published yet. Check back soon!");
      const parsed = CsvCore.parse(await csvRes.text());
      rows = parsed.rows;
      M = model(parsed.headers, rows);
      let meta = null;
      if (metaRes && metaRes.ok) { try { meta = await metaRes.json(); } catch (e) { meta = null; } }
      rank();
      renderStats(meta);
      renderPodium();
      renderChips();
      render();
    } catch (e) {
      $("list").innerHTML = "";
      $("status").hidden = false;
      $("status").textContent = e.message || "Could not load the leaderboard. Please refresh.";
      $("updated").textContent = "Offline";
    }
  }

  // ---------- events ----------
  let t;
  $("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { shown = PAGE; render(); }, 120); });
  $("q").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  $("clear").addEventListener("click", () => { $("q").value = ""; shown = PAGE; render(); $("q").focus(); });
  $("chips").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.sort) sortBy = sortBy === "rank" ? "name" : "rank";
    else filter = b.dataset.f;
    shown = PAGE;
    renderChips(); render();
  });
  $("more-btn").addEventListener("click", () => { shown += PAGE; render(); });
  $("totop").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  window.addEventListener("scroll", () => { $("totop").classList.toggle("on", window.scrollY > 900); }, { passive: true });

  load();
})();
