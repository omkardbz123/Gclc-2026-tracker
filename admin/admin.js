(function () {
  "use strict";
  const C = window.SITE_CONFIG;
  // Missing elements return a detached stub, so one script serves both the login page and the setup page.
  const $ = id => document.getElementById(id) || document.createElement("div");
  const IS_SETUP = document.body.dataset.page === "setup";
  const KEY_URL = new URL("key.json", document.currentScript.src).href.split("?")[0];
  const API = "https://api.github.com/repos/" + C.owner + "/" + C.repo;
  const ITER = 600000;

  let token = null;
  let pending = null; // { headers, rows, removed, stats }

  $("subtitle").textContent = C.title;
  $("repo-name").textContent = C.owner + "/" + C.repo;

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function msg(el, kind, text) { $(el).innerHTML = text ? '<div class="msg ' + kind + '">' + text + "</div>" : ""; }
  function show(id) { ["login", "setup", "upload", "notready"].forEach(p => { $(p).hidden = p !== id; }); }

  // ---------- crypto: the GitHub token is stored encrypted with username + password ----------
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = buf => btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function deriveKey(user, pass, salt, iter) {
    const base = await crypto.subtle.importKey("raw", enc.encode(user.trim().toLowerCase() + "\u0000" + pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function encryptToken(user, pass, tok) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(user, pass, salt, ITER);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(tok));
    return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function decryptToken(user, pass, blob) {
    const key = await deriveKey(user, pass, unb64(blob.salt), blob.iter || ITER);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) }, key, unb64(blob.ct));
    return dec.decode(pt);
  }

  // ---------- GitHub API ----------
  async function gh(path, opts, tok) {
    const res = await fetch(API + path, Object.assign({}, opts, {
      headers: Object.assign({
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + (tok || token),
        "X-GitHub-Api-Version": "2022-11-28"
      }, opts && opts.body ? { "Content-Type": "application/json" } : {})
    }));
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).message || ""; } catch (e) { /* ignore */ }
      const err = new Error(detail || ("GitHub returned " + res.status));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  function friendly(e) {
    if (e.status === 401) return "GitHub rejected the token. It may have expired. Use “Reset login / token” to add a new one.";
    if (e.status === 403 || e.status === 404) return "The token can't write to " + esc(C.owner + "/" + C.repo) + ". Check it has Contents: Read and write on this repo.";
    if (e instanceof TypeError) return "Network error. Check your internet connection and try again.";
    return esc(e.message || "Something went wrong.");
  }

  // Write several files in ONE commit so the site never shows a half-finished update.
  async function commitFiles(files, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh("/git/ref/heads/" + C.branch);
      const head = await gh("/git/commits/" + ref.object.sha);
      const tree = await gh("/git/trees", { method: "POST", body: JSON.stringify({
        base_tree: head.tree.sha,
        tree: files.map(f => ({ path: f.path, mode: "100644", type: "blob", content: f.content }))
      }) });
      const commit = await gh("/git/commits", { method: "POST", body: JSON.stringify({
        message, tree: tree.sha, parents: [ref.object.sha]
      }) });
      try {
        await gh("/git/refs/heads/" + C.branch, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
        return commit;
      } catch (e) {
        if (e.status !== 422 || attempt === 2) throw e; // 422 = someone else published at the same moment; retry
      }
    }
  }

  // ---------- startup ----------
  async function loadKey() {
    try {
      const r = await fetch(KEY_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return null;
      const j = await r.json();
      return j && j.ct ? j : null;
    } catch (e) { return null; }
  }

  let keyBlob = null;
  (async function init() {
    keyBlob = await loadKey();
    if (IS_SETUP) { show("setup"); $("s-user").focus(); }
    else if (keyBlob) { show("login"); $("l-user").focus(); }
    else { show("notready"); }
  })();


  // ---------- setup ----------
  $("setup-form").addEventListener("submit", async e => {
    e.preventDefault();
    const user = $("s-user").value.trim(), pass = $("s-pass").value, tok = $("s-token").value.trim();
    if (!user || !pass || !tok) return;
    $("s-btn").disabled = true;
    msg("setup-msg", "info", "Checking the token with GitHub…");
    try {
      const repo = await gh("", {}, tok);
      if (repo.permissions && repo.permissions.push === false) throw Object.assign(new Error(""), { status: 403 });
      const blob = await encryptToken(user, pass, tok);
      token = tok;
      await commitFiles([{ path: C.keyPath, content: JSON.stringify(blob, null, 2) + "\n" }], "Update admin access");
      keyBlob = blob;
      $("s-token").value = ""; $("s-pass").value = "";
      msg("setup-msg", "ok", 'Done! From now on, admins only need the username and password. <a href="../">Go to admin sign-in →</a> (works in about a minute)');
      $("setup-form").reset();
    } catch (err) {
      token = null;
      msg("setup-msg", "err", friendly(err));
    } finally { $("s-btn").disabled = false; }
  });

  // ---------- login ----------
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    $("l-btn").disabled = true;
    msg("login-msg", "info", "Signing in…");
    try {
      if (!keyBlob) keyBlob = await loadKey();
      if (!keyBlob) { show("notready"); return; }
      let tok;
      try { tok = await decryptToken($("l-user").value, $("l-pass").value, keyBlob); }
      catch (x) { msg("login-msg", "err", "Wrong username or password."); return; }
      token = tok;
      await gh("");
      $("l-pass").value = "";
      msg("login-msg", "", "");
      enterUpload();
    } catch (err) {
      token = null;
      msg("login-msg", "err", friendly(err));
    } finally { $("l-btn").disabled = false; }
  });

  $("logout").onclick = () => { token = null; clearUpload(); show("login"); };

  // ---------- upload ----------
  async function refreshCurrent() {
    try {
      const r = await fetch("../" + C.dataPath + "?t=" + Date.now(), { cache: "no-store" });
      const m = await fetch("../" + C.metaPath + "?t=" + Date.now(), { cache: "no-store" });
      const meta = m.ok ? await m.json() : null;
      if (!r.ok) { $("current").textContent = "Nothing published yet."; return; }
      const parsed = CsvCore.parse(await r.text());
      const when = meta && meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : "unknown time";
      $("current").textContent = "Currently live: " + parsed.rows.length + " participants, updated " + when + ".";
    } catch (e) { $("current").textContent = "Currently live data could not be read."; }
  }

  function enterUpload() { show("upload"); refreshCurrent(); }

  function clearUpload() {
    pending = null;
    $("files").innerHTML = ""; $("result").hidden = true; $("file").value = "";
    msg("pub-msg", "", "");
  }
  $("clear").onclick = clearUpload;

  const drop = $("drop");
  drop.onclick = () => $("file").click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } };
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
  $("file").addEventListener("change", e => handleFiles(e.target.files));

  async function handleFiles(fileList) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    msg("pub-msg", "", "");
    const parsed = [], lines = [];
    for (const f of list) {
      const isExcel = /\.(xlsx|xls)$/i.test(f.name) || /spreadsheetml|ms-excel/i.test(f.type);
      if (!isExcel && !/\.csv$/i.test(f.name) && f.type && !/csv|text/i.test(f.type)) {
        lines.push('<li><span>' + esc(f.name) + '</span><span class="bad">Not an Excel or CSV file</span></li>');
        continue;
      }
      try {
        const p = CsvCore.parse(isExcel ? await excelToCsv(f) : await f.text());
        parsed.push(p);
        lines.push("<li><span>" + esc(f.name) + "</span><span>" + p.rows.length + " rows ✓</span></li>");
      } catch (err) {
        lines.push('<li><span>' + esc(f.name) + '</span><span class="bad">' + esc(err.message) + "</span></li>");
      }
    }
    $("files").innerHTML = lines.join("");
    if (!parsed.length) { $("result").hidden = true; pending = null; return; }

    const merged = CsvCore.merge(parsed);
    const clean = CsvCore.stripSensitive(merged.headers, merged.rows);
    pending = { headers: clean.headers, rows: clean.rows, removed: clean.removed, stats: merged.stats, files: list.map(f => f.name) };

    $("r-rows").textContent = clean.rows.length;
    $("r-dups").textContent = merged.stats.duplicates;
    $("r-cols").textContent = clean.headers.length;
    const notes = [];
    if (clean.masked) notes.push('<div class="msg info">' + clean.masked + " email address(es) typed into other fields (like the name) were hidden.</div>");
    if (clean.removed.length) notes.push('<div class="msg info">Private columns removed before publishing: <b>' + clean.removed.map(esc).join(", ") + "</b></div>");
    if (parsed.length < list.length) notes.push('<div class="msg warn">Some files had problems and were skipped (see above).</div>');
    if (merged.stats.unkeyed) notes.push('<div class="msg warn">' + merged.stats.unkeyed + " row(s) had no name, email or profile link and were kept as-is.</div>");
    $("r-notes").innerHTML = notes.join("");

    const show5 = clean.rows.slice(0, 5);
    $("p-head").innerHTML = clean.headers.map(h => "<th>" + esc(h) + "</th>").join("");
    $("p-body").innerHTML = show5.map(r => "<tr>" + clean.headers.map(h => "<td>" + esc(String(r[h]).slice(0, 60)) + (String(r[h]).length > 60 ? "…" : "") + "</td>").join("") + "</tr>").join("") +
      (clean.rows.length > 5 ? '<tr><td colspan="' + clean.headers.length + '" style="color:var(--muted)">…and ' + (clean.rows.length - 5) + " more</td></tr>" : "");
    $("result").hidden = false;
  }

  // Read the first sheet of an Excel file as CSV text.
  async function excelToCsv(file) {
    if (!window.XLSX) throw new Error("Excel reader didn't load. Check your connection and refresh.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const name = wb.SheetNames[0];
    if (!name) throw new Error("The Excel file has no sheets.");
    return XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
  }

  function stamp(d) {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  $("publish").onclick = async () => {
    if (!pending || !token) return;
    $("publish").disabled = true; $("clear").disabled = true;
    msg("pub-msg", "info", "Publishing…");
    try {
      const now = new Date();
      const csv = CsvCore.toCsv(pending.headers, pending.rows);
      const meta = { updatedAt: now.toISOString(), participants: pending.rows.length, sourceFiles: pending.files };
      await commitFiles([
        { path: C.dataPath, content: csv },
        { path: C.metaPath, content: JSON.stringify(meta, null, 2) + "\n" },
        { path: "data/history/" + stamp(now) + ".csv", content: csv }
      ], "Data update " + now.toISOString().slice(0, 10) + " (" + pending.rows.length + " participants)");
      msg("pub-msg", "ok", "Published " + pending.rows.length + " participants. The live site refreshes in about a minute.");
      pending = null;
      $("result").hidden = true; $("files").innerHTML = ""; $("file").value = "";
      setTimeout(refreshCurrent, 60000);
    } catch (err) {
      msg("pub-msg", "err", friendly(err) + " Nothing was changed on the site.");
    } finally { $("publish").disabled = false; $("clear").disabled = false; }
  };
})();
