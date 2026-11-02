(function () {
  "use strict";
  const C = window.SITE_CONFIG;
  const $ = id => document.getElementById(id);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const PAGE = 50;

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = v => { const n = CsvCore.num(v); return isNaN(n) ? 0 : n; };
  const NA = v => CsvCore.isNA(v);

  let rows = [], M = null;
  let filter = "all", sortBy = "rank", shown = PAGE, openKey = null;

  // ---------------- understanding the columns ----------------
  function shortLabel(h) {
    return h
      .replace(/google cloud skills boost/ig, "")
      .replace(/^(#|no\.?|number)\s*of\s*/i, "")
      .replace(/\b(names?\s+of\s+|names?\b)/ig, "")
      .replace(/\b(status|redemption|completed|count)\b/ig, "")
      .replace(/\s{2,}/g, " ").replace(/^[\s\-–:&]+|[\s\-–:&]+$/g, "").trim() || h;
  }

  function model(headers, data) {
    const d = CsvCore.describe(headers, data);
    const serial = /^(s\.?\s*no\.?|sr\.?\s*no\.?|sl\.?\s*no\.?|#|rank|index|id|no\.?)$/i;
    const visible = headers.filter(h => !d.sensitive.includes(h));
    const metrics = visible.filter(h => d.types[h] === "number" && !serial.test(h));
    const score = metrics.find(h => /(badge|total|score|points|completed)/i.test(h)) || metrics[0] || null;
    if (score) { metrics.splice(metrics.indexOf(score), 1); metrics.unshift(score); }
    const urlCol = visible.find(h => d.types[h] === "url" && /profile/i.test(h)) || visible.find(h => d.types[h] === "url") || null;
    const listCols = visible.filter(h => h !== d.nameCol && d.types[h] !== "number" && d.types[h] !== "url" &&
      (d.types[h] === "long" || /(names|badges)/i.test(h) || data.filter(r => / \| /.test(r[h])).length >= Math.max(1, data.length * 0.15)));
    const statusCols = visible.filter(h => d.types[h] === "status" && !listCols.includes(h));
    const milestoneCol = statusCols.find(h => /milestone/i.test(h)) || null;
    const completeCol = statusCols.find(h => /\ball\b/i.test(h) && /complet/i.test(h)) || null;
    const otherCols = visible.filter(h => h !== d.nameCol && !metrics.includes(h) && h !== urlCol &&
      !listCols.includes(h) && !statusCols.includes(h) && !serial.test(h));
    const max = {};
    metrics.forEach(h => { max[h] = (C.targets && C.targets[h]) || Math.max(1, ...data.map(r => num(r[h]))); });
    return { nameCol: d.nameCol, score, metrics: metrics.slice(0, 4), urlCol, listCols, statusCols, milestoneCol, completeCol, otherCols, max };
  }

  const hasMilestone = v => !NA(v) && !/^no\b/i.test(String(v).trim());
  const milestoneLevel = v => { if (!hasMilestone(v)) return 0; const m = String(v).match(/\d+/); return m ? +m[0] : 1; };
  const isYes = v => /^(yes|y|true|done|completed?|1)$/i.test(String(v).trim());
  function tone(v) {
    const s = String(v).toLowerCase();
    if (/\b(no|not|invalid|wrong|fail|failed|false|pending|incomplete|error)\b/.test(s)) return "bad";
    if (/\b(yes|good|done|complete|completed|redeemed|valid|true|ok|active)\b/.test(s)) return "good";
    return "warn";
  }
  // Items are separated by " | " or ", ". Badge names are multi-word, so a one-word piece
  // (like "Store" in "Store, Process, and Manage Data…") belongs to the next item.
  function splitList(v) {
    if (NA(v)) return [];
    const parts = String(v).split(/\s*\|\s*|,\s*(?=[A-Z0-9])/).map(x => x.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      if (!/\s/.test(parts[i]) && i + 1 < parts.length) { parts[i + 1] = parts[i] + ", " + parts[i + 1]; continue; }
      out.push(parts[i]);
    }
    return out;
  }

  const scoreOf = r => (M.score ? num(r[M.score]) : 0);
  const msOf = r => (M.milestoneCol ? milestoneLevel(r[M.milestoneCol]) : 0);

  // Rank by badges, then milestone. Exactly equal people share a rank.
  function rank() {
    const sorted = rows.slice().sort((a, b) => scoreOf(b) - scoreOf(a) || msOf(b) - msOf(a));
    let prev = null, r = 0;
    sorted.forEach((row, i) => {
      const key = scoreOf(row) + ":" + msOf(row);
      if (key !== prev) { r = i + 1; prev = key; }
      row.__rank = r;
    });
    rows.forEach((row, i) => { row.__key = "p" + i; });
  }

  function initials(name) {
    const p = String(name || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  function avClass(name) {
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return "av" + (h % 6);
  }
  function highlight(text, q) {
    const t = String(text);
    if (!q) return esc(t);
    const i = t.toLowerCase().indexOf(q);
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
  }
  const medalClass = rk => ["", "bg-gold", "bg-silver", "bg-bronze"][rk] || "";
  const unit = () => (M.score && /badge/i.test(M.score) ? "badges" : (M.score ? shortLabel(M.score).toLowerCase() : ""));

  // ---------------- home ----------------
  function renderUpdated(meta) {
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
    $$(".js-updated").forEach(el => { el.textContent = el.dataset.short ? label.replace(/^Updated /, "") : label; });
    $$(".js-sample").forEach(el => { el.hidden = !(meta && meta.sample); });
  }

  function renderPodium() {
    if (!M.score) return;
    const top = rows.filter(r => scoreOf(r) > 0).sort((a, b) => a.__rank - b.__rank || String(a[M.nameCol]).localeCompare(String(b[M.nameCol]))).slice(0, 3);
    if (top.length < 3) return;
    const order = [[top[1], 2], [top[0], 1], [top[2], 3]];
    $("podium").innerHTML = order.map(([r, place]) => {
      const mc = medalClass(Math.min(r.__rank, 3));
      const ms = M.milestoneCol && hasMilestone(r[M.milestoneCol]) ? '<div class="ms"><span class="pill ms">🏅 ' + esc(r[M.milestoneCol]) + "</span></div>" : "";
      return '<div class="pod p' + place + '" data-open="' + r.__key + '" role="button" tabindex="0">' +
        (place === 1 ? '<span class="crown" aria-hidden="true">👑</span>' : "") +
        '<div class="avatar ' + mc + '">' + esc(initials(r[M.nameCol])) + '<span class="medal ' + mc + '">' + r.__rank + "</span></div>" +
        '<div class="nm">' + esc(r[M.nameCol]) + "</div>" +
        '<div class="sc">' + scoreOf(r) + '</div><div class="sl">' + esc(unit()) + "</div>" + ms + "</div>";
    }).join("");
    $("top-block").hidden = false;
  }

  // ---------------- leaderboard ----------------
  function counts() {
    const c = { all: rows.length, started: 0, idle: 0, ms: 0, done: 0 };
    rows.forEach(r => {
      if (scoreOf(r) > 0) c.started++; else c.idle++;
      if (M.milestoneCol && hasMilestone(r[M.milestoneCol])) c.ms++;
      if (M.completeCol && isYes(r[M.completeCol])) c.done++;
    });
    return c;
  }

  function filterOptions() {
    const c = counts();
    const o = [["all", "Everyone", c.all]];
    if (M.score) o.push(["started", "Started", c.started], ["idle", "Not started", c.idle]);
    if (M.milestoneCol) o.push(["ms", "Milestone reached", c.ms]);
    if (M.completeCol) o.push(["done", "Completed all", c.done]);
    return o;
  }
  const sortOptions = () => [["rank", "Rank"], ["name", "Name A–Z"], ["low", "Fewest " + (unit() || "points")]];

  function renderSheet() {
    $("opt-filter").innerHTML = filterOptions().map(([k, l, n]) =>
      '<button class="opt" type="button" role="radio" data-f="' + k + '" aria-checked="' + (filter === k) + '">' + l + " <b>" + n + "</b></button>").join("");
    $("opt-sort").innerHTML = sortOptions().map(([k, l]) =>
      '<button class="opt" type="button" role="radio" data-s="' + k + '" aria-checked="' + (sortBy === k) + '">' + l + "</button>").join("");
    const active = filter !== "all" || sortBy !== "rank";
    $("filter-dot").hidden = !active;
    $("filter-btn").classList.toggle("on", active);
  }

  function rowHtml(r, q) {
    const rk = r.__rank, s = scoreOf(r);
    const top = s > 0 && rk <= 3;
    const meta = [];
    if (M.milestoneCol && hasMilestone(r[M.milestoneCol])) meta.push('<span class="pill ms">🏅 ' + esc(r[M.milestoneCol]) + "</span>");
    if (M.completeCol && isYes(r[M.completeCol])) meta.push('<span class="pill good">✓ Completed all</span>');
    M.statusCols.filter(h => h !== M.milestoneCol && h !== M.completeCol && !NA(r[h]) && tone(r[h]) !== "good").forEach(h => {
      const v = String(r[h]);
      const label = /access\s*code/i.test(h) && /^no$/i.test(v) ? "Code not redeemed"
        : /profile/i.test(h) ? "Profile URL issue" : shortLabel(h) + ": " + v;
      meta.push('<span class="pill ' + tone(v) + '">' + esc(label) + "</span>");
    });
    const pct = M.score ? Math.min(100, (s / M.max[M.score]) * 100) : 0;
    const open = openKey === r.__key;
    return '<li class="row' + (top ? " r" + rk : "") + (open ? " open" : "") + '" data-key="' + r.__key + '">' +
      '<button class="row-main" type="button" aria-expanded="' + open + '">' +
        '<span class="rk">' + (top ? '<span class="m ' + medalClass(rk) + '">' + rk + "</span>" : rk) + "</span>" +
        '<span class="avatar ' + avClass(r[M.nameCol]) + '">' + esc(initials(r[M.nameCol])) + "</span>" +
        '<span class="who"><span class="nm">' + highlight(r[M.nameCol], q) + "</span>" +
          (meta.length ? '<span class="meta">' + meta.join("") + "</span>" : "") +
          (M.score ? '<span class="mini"><i style="width:' + pct.toFixed(1) + '%"></i></span>' : "") +
        "</span>" +
        (M.score ? '<span class="score' + (s ? "" : " zero") + '"><b>' + s + "</b><small>" + esc(unit()) + "</small></span>" : "<span></span>") +
      "</button>" +
      (open ? '<div class="row-more">' + detailsHtml(r) + "</div>" : "") +
    "</li>";
  }

  function detailsHtml(r) {
    const parts = [];
    M.metrics.filter(h => h !== M.score).forEach(h => {
      const v = num(r[h]), mx = M.max[h];
      parts.push('<div class="metric"><div class="top"><span class="lbl">' + esc(shortLabel(h)) + '</span><span class="val">' + v +
        ' <small>/ ' + mx + '</small></span></div><div class="bar"><i style="width:' + Math.min(100, v / mx * 100).toFixed(1) + '%"></i></div></div>');
    });
    M.listCols.forEach(h => {
      const items = splitList(r[h]);
      if (items.length) parts.push('<p class="sub-h">' + esc(shortLabel(h)) + " · " + items.length + '</p><div class="tags">' +
        items.map(t => '<span class="tag">' + esc(t) + "</span>").join("") + "</div>");
    });
    M.otherCols.filter(h => !NA(r[h])).forEach(h => {
      const v = String(r[h]);
      const body = /^https?:\/\//i.test(v) ? '<a href="' + esc(v) + '" target="_blank" rel="noopener noreferrer" style="color:var(--blue);font-weight:600">Open ↗</a>' : esc(v);
      parts.push('<p class="sub-h">' + esc(shortLabel(h)) + "</p><div>" + body + "</div>");
    });
    if (M.score && scoreOf(r) === 0 && !M.listCols.some(h => splitList(r[h]).length)) {
      parts.push('<p class="sub-h">Badges</p><div class="muted" style="font-size:13px">No badges yet. Every badge you earn shows up here the next day.</div>');
    }
    if (M.urlCol && /^https?:\/\//i.test(r[M.urlCol])) {
      parts.push('<a class="profile-btn" href="' + esc(r[M.urlCol]) + '" target="_blank" rel="noopener noreferrer">View Google Skills profile ' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg></a>');
    }
    return parts.join("");
  }

  function current() {
    const q = $("q").value.trim().toLowerCase();
    const list = rows.filter(r => {
      if (filter === "started" && !(scoreOf(r) > 0)) return false;
      if (filter === "idle" && scoreOf(r) > 0) return false;
      if (filter === "ms" && !hasMilestone(r[M.milestoneCol])) return false;
      if (filter === "done" && !isYes(r[M.completeCol])) return false;
      return !q || String(r[M.nameCol]).toLowerCase().includes(q);
    });
    const byName = (a, b) => String(a[M.nameCol]).localeCompare(String(b[M.nameCol]), undefined, { sensitivity: "base" });
    list.sort(sortBy === "name" ? byName
      : sortBy === "low" ? (a, b) => b.__rank - a.__rank || byName(a, b)
      : (a, b) => a.__rank - b.__rank || byName(a, b));
    return { list, q };
  }

  function render() {
    const { list, q } = current();
    $("list").innerHTML = list.slice(0, shown).map(r => rowHtml(r, q)).join("");
    $("list").hidden = !list.length;
    $("empty").hidden = list.length > 0;
    if (!list.length) $("empty").innerHTML = q ? "No one named “" + esc(q) + "”.<br>Check the spelling, or try just your first name." : "Nobody in this group yet.";
    $("more").hidden = list.length <= shown;
    $("more-btn").textContent = "Show more (" + (list.length - shown) + " left)";
    const sortName = (sortOptions().find(s => s[0] === sortBy) || [])[1] || "";
    const filtName = (filterOptions().find(f => f[0] === filter) || [])[1] || "";
    $("result-line").textContent = list.length + (list.length === 1 ? " participant" : " participants") +
      (filter !== "all" ? " · " + filtName : "") + " · by " + sortName.toLowerCase();
    $("clear").hidden = !q;
  }

  // ---------------- navigation ----------------
  function go(view, opts) {
    opts = opts || {};
    $("view-home").hidden = view !== "home";
    $("view-board").hidden = view !== "board";
    $$(".tab").forEach(t => t.setAttribute("aria-current", t.dataset.go === view ? "page" : "false"));
    const hash = view === "board" ? "#leaderboard" : "#";
    if (location.hash !== hash && !(hash === "#" && !location.hash)) history.replaceState(null, "", hash === "#" ? location.pathname + location.search : hash);
    if (!opts.keepScroll) window.scrollTo(0, 0);
    if (opts.focus) setTimeout(() => $("q").focus(), 50);
  }

  function openRow(key, scroll) {
    openKey = openKey === key ? null : key;
    const r = rows.find(x => x.__key === key);
    if (r && openKey) {
      // Make sure the row is on the current page of results.
      const idx = current().list.indexOf(r);
      if (idx >= shown) shown = Math.ceil((idx + 1) / PAGE) * PAGE;
      if (idx < 0) { filter = "all"; $("q").value = ""; renderSheet(); }
    }
    render();
    if (scroll && openKey) {
      const el = document.querySelector('.row[data-key="' + key + '"]');
      if (el) el.scrollIntoView({ block: "center" });
    }
  }

  // ---------------- filter sheet ----------------
  function openSheet() { renderSheet(); $("sheet").hidden = false; $("sheet-backdrop").hidden = false; document.body.classList.add("sheet-open"); }
  function closeSheet() { $("sheet").hidden = true; $("sheet-backdrop").hidden = true; document.body.classList.remove("sheet-open"); }

  // ---------------- data ----------------
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
      renderUpdated(meta);
      renderPodium();
      renderSheet();
      render();
    } catch (e) {
      $("list").innerHTML = "";
      $("status").hidden = false;
      $("status").textContent = e.message || "Could not load the leaderboard. Please refresh.";
      $$(".js-updated").forEach(el => { el.textContent = "Offline"; });
    }
  }

  // ---------------- events ----------------
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]");
    if (g) { go(g.dataset.go, { focus: !!g.dataset.focus }); return; }
    const pod = e.target.closest("[data-open]");
    if (pod && M) { go("board"); openRow(pod.dataset.open, true); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("sheet").hidden) closeSheet();
    const pod = e.target.closest && e.target.closest("[data-open]");
    if (pod && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pod.click(); }
  });
  $("list").addEventListener("click", e => {
    const b = e.target.closest(".row-main");
    if (b) openRow(b.parentElement.dataset.key, false);
  });

  let t;
  $("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { shown = PAGE; openKey = null; render(); }, 120); });
  $("q").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
  $("clear").addEventListener("click", () => { $("q").value = ""; shown = PAGE; render(); $("q").focus(); });

  $("filter-btn").addEventListener("click", openSheet);
  $("sheet-backdrop").addEventListener("click", closeSheet);
  $("sheet-done").addEventListener("click", closeSheet);
  $("sheet-reset").addEventListener("click", () => { filter = "all"; sortBy = "rank"; shown = PAGE; renderSheet(); render(); });
  $("sheet").addEventListener("click", e => {
    const b = e.target.closest(".opt");
    if (!b) return;
    if (b.dataset.f) filter = b.dataset.f;
    if (b.dataset.s) sortBy = b.dataset.s;
    shown = PAGE; openKey = null;
    renderSheet(); render();
  });

  $("more-btn").addEventListener("click", () => { shown += PAGE; render(); });
  $("totop").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  window.addEventListener("scroll", () => { $("totop").classList.toggle("on", window.scrollY > 900); }, { passive: true });
  window.addEventListener("hashchange", () => go(location.hash === "#leaderboard" ? "board" : "home"));

  go(location.hash === "#leaderboard" ? "board" : "home", { keepScroll: true });
  load();
})();
