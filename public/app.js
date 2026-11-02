/* UI layer. All math lives in engine.js. */
(function () {
  "use strict";
  const E = window.Engine;
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const VIEWS = [
    { id: "overview", label: "Overview", group: "Command" },
    { id: "budget", label: "Budget allocation", group: "Agents", n: "01" },
    { id: "keywords", label: "Keywords", n: "02" },
    { id: "audiences", label: "Audiences", n: "03" },
    { id: "creative", label: "Creative", n: "04" },
  ];
  const HOOKS = ["question", "urgency", "social_proof", "benefit", "ugc", "offer", "problem_solution"];
  const FORMATS = ["static", "video", "carousel", "short_video"];
  const PLATFORMS = ["Meta", "Google Search", "YouTube", "TikTok", "LinkedIn"];
  const STORE = "pmo-state-v3";
  // Sample clients shown until an ads connector is wired in. Fictional businesses.
  const SAMPLE_CLIENTS = [
    { id: "northwind", name: "Northwind Apparel", vertical: "D2C fashion", seed: 7, channels: null },
    { id: "lumen", name: "Lumen Skin Clinics", vertical: "Clinics", seed: 21, channels: ["google_search", "meta", "youtube"] },
    { id: "peak", name: "Peak Protein Co.", vertical: "Nutrition D2C", seed: 42, channels: ["google_search", "google_pmax", "meta", "tiktok"] },
  ];
  // Fields that belong to one client. They live on `st` for the active client and in st.workspaces[id] otherwise.
  const WS_KEYS = ["seed", "source", "channels", "keywords", "audience", "variants", "creatives", "alloc", "selCh", "kwTheme", "ideas", "ideaSource", "creativeCh", "variantMetric", "syncedAt", "liveCurrency", "mixedCurrencies"];

  function makeWorkspace(seed, channelIds) {
    const channels = E.sampleChannels(seed, undefined, channelIds);
    return { seed, source: { channels: "sample", keywords: "sample", audience: "sample", creatives: "sample" },
      channels, keywords: E.sampleKeywords(seed), audience: E.sampleAudience(seed), variants: E.sampleVariants(seed),
      creatives: E.sampleCreativeCtr(seed, channels), alloc: null, selCh: channels[0].id, kwTheme: null, ideas: [], ideaSource: null, creativeCh: "all",
      total: null, since: null, targetCpa: 40 };
  }
  function activateInto(state, id) {
    const ws = state.workspaces[id]; WS_KEYS.forEach((k) => (state[k] = ws[k]));
    state.s.total = ws.total; state.s.since = ws.since; if (ws.targetCpa != null) state.s.targetCpa = ws.targetCpa; state.clientId = id; return state;
  }
  function stash() {
    const ws = st.workspaces && st.workspaces[st.clientId]; if (!ws) return;
    WS_KEYS.forEach((k) => (ws[k] = st[k])); ws.total = st.s.total; ws.since = st.s.since; ws.targetCpa = st.s.targetCpa;
  }
  function fresh() {
    const base = {
      currency: "$", clientId: null, mode: null, // mode: null = start screen not answered yet, "demo" or "upload"
      clients: SAMPLE_CLIENTS.map((c) => ({ id: c.id, name: c.name, vertical: c.vertical, origin: "sample" })),
      workspaces: Object.fromEntries(SAMPLE_CLIENTS.map((c) => [c.id, makeWorkspace(c.seed, c.channels)])),
      s: { since: null, limitShift: true, fatigueWeight: 50, perfMetric: "roas_cum",
        total: null, maxShift: 30, lowConfShift: 10, lookback: 14, targetRoas: null, targetCpa: 40, minClicks: 100, nThemes: 4,
        audK: 0, ax: "recency_days", ay: "monetary", zThr: 3.5 },
      log: [], kwIntent: "all", kwAction: "all", kwQuery: "", kwSort: { key: "cost", dir: -1 },
      ideaForm: { product: "", audience: "All customers", platform: "Meta", tone: "Confident and plain-spoken", notes: "" },
    };
    return activateInto(base, base.clients[0].id);
  }
  let st = load() || fresh();
  let R = null; // computed results
  let view = "overview";
  let audVersion = 0, audCache = { key: null, res: null };
  let generating = false, storageWarned = false;
  const charts = {};

  function load() {
    try {
      const raw = localStorage.getItem(STORE); if (!raw) return null; const v = JSON.parse(raw);
      if (!v.mode || !v.workspaces || !v.clients || !v.clients.length) return null;
      const base = fresh(); const out = { ...base, ...v, s: { ...base.s, ...v.s }, ideaForm: { ...base.ideaForm, ...v.ideaForm } };
      out.clients = out.clients.filter((c) => out.workspaces[c.id]);
      if (!out.clients.length) return null;
      return activateInto(out, out.workspaces[v.clientId] ? v.clientId : out.clients[0].id);
    }
    catch (e) { return null; }
  }
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!st.mode) return;
      try { stash(); localStorage.setItem(STORE, JSON.stringify(serializable())); }
      catch (e) { if (!storageWarned) { storageWarned = true; toast("Browser storage is full or blocked. Your data stays for this visit only."); } }
    }, 400);
  }
  // The active client's fields live inside workspaces[id] when saved, so don't store them twice.
  function serializable() { const out = { ...st }; WS_KEYS.forEach((k) => delete out[k]); return out; }

  // ---------------- formatting ----------------
  const money = (n, dp = 0) => {
    if (n == null || !isFinite(n)) return "–";
    const a = Math.abs(n), sign = n < 0 ? "-" : "";
    if (a >= 1e6) return `${sign}${st.currency}${(a / 1e6).toFixed(2)}M`;
    return `${sign}${st.currency}${a.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  };
  const pct = (x, dp = 1) => (x == null || !isFinite(x) ? "–" : `${(x * 100).toFixed(dp)}%`);
  const spct = (x, dp = 1) => (x == null || !isFinite(x) ? "–" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(dp)}%`);
  const int = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
  const x2 = (n) => (n == null || !isFinite(n) ? "–" : `${n.toFixed(2)}x`);
  const nice = (s) => String(s).replace(/_/g, " ");
  const cssv = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const palette = () => ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"].map(cssv);
  const colorAt = (i) => palette()[i % 6];
  const alpha = (hex, a) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

  // ---------------- compute ----------------
  const chLabel = (id) => (st.channels.find((c) => c.id === id) || { label: id }).label;
  const fmtDate = (iso) => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  const lastDate = () => st.channels.reduce((m, c) => (c.dates && c.dates.length && c.dates[c.dates.length - 1] > m ? c.dates[c.dates.length - 1] : m), "");
  const firstDate = () => st.channels.reduce((m, c) => (c.start && (!m || c.start < m) ? c.start : m), "");

  function compute() {
    const s = st.s;
    const anoms = E.anomalies(st.channels, { z: s.zThr });

    // performance since the chosen date (or each campaign's own start)
    const perf = Object.fromEntries(st.channels.map((c) => [c.id, E.performance(c, s.since)]));
    // creative fatigue per channel
    const fat = E.fatigue(st.creatives);
    const fatByCh = Object.fromEntries(st.channels.map((c) => [c.id, E.channelFatigue(fat, c.id)]));
    // fit curves on the performance window (at least the last 8 days)
    const fitCh = st.channels.map((c) => { const w = E.windowed(c, s.since); return w.spend.length >= 8 ? w : E.windowed(c, c.dates[Math.max(0, c.dates.length - 8)]); });
    const proposal = E.optimizeBudget(fitCh, { total: s.total, maxShift: s.maxShift / 100, lowConfShift: s.lowConfShift / 100, lookback: s.lookback, targetRoas: s.targetRoas,
      limitShift: s.limitShift, fatigue: Object.fromEntries(Object.entries(fatByCh).map(([k, v]) => [k, v.index])), fatigueWeight: s.fatigueWeight / 100,
      excludeLastDay: new Set(anoms.filter((a) => a.freeze).map((a) => a.id)) });

    // the applied plan = amounts from the last time "Re-allocate" was pressed
    const A = st.alloc;
    const rowsApplied = proposal.rows.map((r) => {
      const amt = !r.enabled ? 0 : A && A.amounts[r.id] != null ? A.amounts[r.id] : r.current;
      const x = { ...r, proposed: r.recommended, recommended: amt };
      x.delta = x.current ? (amt - x.current) / x.current : 0;
      x.marginal = E.curveMarginal(x.fit, Math.max(amt, 1)); x.effMarginal = x.marginal * x.penalty;
      x.reason = !r.enabled ? "Paused by you." : A ? A.reasons[r.id] || "Not part of the last run. Re-allocate to include it." : "Press Re-allocate to get a new amount.";
      return x;
    });
    const sumApplied = E.sum(rowsApplied.map((r) => r.recommended));
    const revApplied = E.sum(rowsApplied.map((r) => E.curveRev(r.fit, r.recommended)));
    const budget = { rows: rowsApplied, budget: sumApplied, spendNow: proposal.spendNow, revNow: proposal.revNow, revNew: revApplied,
      uplift: proposal.revNow ? revApplied / proposal.revNow - 1 : 0, notes: A ? A.notes : [] };
    const allocStale = !A || proposal.rows.some((r) => Math.abs((A.amounts[r.id] != null ? A.amounts[r.id] : -1) - r.recommended) > Math.max(1, r.recommended * 0.01));

    budget.rows.forEach((r) => { r.final = r.recommended; });
    const finalTotal = budget.budget;

    const kw = st.keywords.length >= 3 ? E.analyzeKeywords(st.keywords, { targetCpa: s.targetCpa, minClicks: s.minClicks, nThemes: s.nThemes }) : { rows: [], themes: [], wasted: 0, empty: true };

    const ak = `${audVersion}:${s.audK}`;
    if (audCache.key !== ak) audCache = { key: ak, res: st.audience.length >= 30 ? E.segmentAudience(st.audience, { k: s.audK || null }) : { k: 0, segments: [], labels: [], scores: {}, empty: true } };
    const aud = audCache.res;

    const effects = E.attributeEffects(st.variants), combos = E.untestedCombos(st.variants, effects);

    // findings
    const F = [];
    anoms.forEach((a) => F.push({ sev: a.severity, agent: "Budget", title: `${a.label}: ${a.title.toLowerCase()}`, detail: a.detail + (a.freeze ? " That day is left out when fitting this channel's curve." : ""), view: "budget" }));
    if (allocStale && proposal.uplift > 0.002) F.push({ sev: "info", agent: "Budget", title: A ? "Inputs changed since the last re-allocation" : "Budget re-allocation ready", detail: `Re-allocating now would change modelled revenue ${spct(A ? proposal.revNew / revApplied - 1 : proposal.uplift)} on ${money(proposal.budget)}/day.`, view: "budget" });
    budget.notes.forEach((n) => F.push({ sev: "warn", agent: "Budget", title: "Budget constraint", detail: n, view: "budget" }));
    budget.rows.filter((r) => r.flags.includes("below_target")).forEach((r) => F.push({ sev: "warn", agent: "Budget", title: `${r.label}: next dollar below target ROAS`, detail: `Marginal ROAS ${x2(r.marginal)} vs target ${x2(s.targetRoas)}. Hold back incremental spend here.`, view: "budget" }));
    budget.rows.filter((r) => r.flags.includes("low_confidence")).forEach((r) => F.push({ sev: "info", agent: "Budget", title: `${r.label}: response curve is uncertain`, detail: `Fit R² ${r.fit.r2.toFixed(2)}. Moves are limited to ±${s.lowConfShift}%; vary spend more to learn the curve.`, view: "budget" }));
    const negs = kw.rows.filter((r) => r.action === "negative");
    if (negs.length) F.push({ sev: "warn", agent: "Keywords", title: `${negs.length} keywords to add as negatives`, detail: `They spent ${money(kw.wasted)} at CPA above target or with no conversions.`, view: "keywords" });
    fat.filter((f) => f.fatigued).forEach((f) => F.push({ sev: "warn", agent: "Creative", title: `${f.name} (${chLabel(f.channel)}) is fatiguing`, detail: `CTR down ${pct(f.drop, 0)} (first 7 days vs last 7). Rotate in a fresh variant.`, view: "creative" }));
    const order = { critical: 0, warn: 1, info: 2, good: 3 };
    F.sort((a, b) => order[a.sev] - order[b.sev]);
    return { anoms, budget, proposal, allocStale, perf, fatByCh, finalTotal, kw, aud, effects, combos, fat, findings: F };
  }
  // ---------------- shell rendering ----------------
  function renderNav() {
    const counts = {};
    R.findings.forEach((f) => { if (f.sev === "critical" || f.sev === "warn") { counts[f.view] = counts[f.view] || { n: 0, sev: "warn" }; counts[f.view].n++; if (f.sev === "critical") counts[f.view].sev = "bad"; } });
    let html = "", group = null;
    VIEWS.forEach((v) => {
      if (v.group && v.group !== group) { group = v.group; html += `<div class="nav-group">${esc(group)}</div>`; }
      const c = counts[v.id];
      html += `<a href="#${v.id}" ${view === v.id ? 'aria-current="page"' : ""}><span class="idx">${v.n || ""}</span><span class="lbl">${esc(v.label)}</span>${c ? `<span class="badge ${c.sev}">${c.n}</span>` : ""}</a>`;
    });
    $("#nav").innerHTML = html;
    const by = (v) => Object.entries(st.source).filter(([, x]) => x === v).map(([k]) => k);
    const parts = [by("live").length && `synced: ${by("live").join(", ")}`, by("upload").length && `uploaded: ${by("upload").join(", ")}`, by("sample").length && `sample: ${by("sample").join(", ")}`].filter(Boolean);
    $("#data-source").textContent = `${clientName()}. Data ${parts.join("; ")}.`;
    $("#currency").value = st.currency; renderClientPicker();
    const reg = document.querySelector('[data-action="regen"]'); if (reg) reg.style.display = clientOrigin() === "sample" ? "" : "none";
    const cd = $("#btn-clear-demo"); if (cd) cd.style.display = st.clients.some((c) => c.origin === "sample") && st.clients.some((c) => c.origin === "manual") ? "" : "none";
  }
  function renderStrip() {
    const b = R.budget, open = R.findings.filter((f) => f.sev === "critical" || f.sev === "warn").length;
    $("#strip").innerHTML = [
      ["Daily budget", money(b.budget)],
      ["Modelled revenue / day", `${money(b.revNow)} → ${money(b.revNew)}`],
      [Math.abs(b.budget - b.spendNow) > b.spendNow * 0.01 ? "Revenue change" : "Optimizer uplift", `<span class="${b.uplift >= 0 ? "up" : "down"}">${spct(b.uplift)}</span>`],
      ["Open alerts", `<span class="${open ? "down" : "up"}">${open}</span>`],
    ].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
  }
  function renderView() {
    const V = VIEW_IMPL[view];
    $("#view-title").textContent = VIEWS.find((v) => v.id === view).label;
    $("#view").innerHTML = `${V.lead ? `<p class="lead">${V.lead}</p>` : ""}${V.controls ? `<section class="card" aria-label="Settings"><div class="controls">${V.controls()}</div></section>` : ""}<div id="results" class="view"></div>`;
    renderResults();
    $("#rail").classList.remove("open");
  }
  function renderResults() {
    const focusId = document.activeElement && document.activeElement.id;
    const V = VIEW_IMPL[view];
    $("#results").innerHTML = V.results();
    Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; });
    if (V.charts && window.Chart) { try { V.charts(); } catch (e) { console.error(e); } }
    if (focusId) { const el = document.getElementById(focusId); if (el && el !== document.activeElement) el.focus(); }
  }
  function recompute() { R = compute(); renderResults(); renderNav(); renderStrip(); save(); }
  let recT = null;
  const scheduleRecompute = () => { clearTimeout(recT); recT = setTimeout(recompute, 90); };

  // ---------------- chart helpers ----------------
  function baseOpts(extra = {}) {
    const ink2 = cssv("--ink-2"), line = cssv("--line");
    return Object.assign({
      responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
      plugins: { legend: { labels: { color: ink2, boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: { mode: "nearest", intersect: false } },
      scales: { x: { grid: { color: line }, ticks: { color: ink2, font: { size: 11 } }, border: { color: line } }, y: { grid: { color: line }, ticks: { color: ink2, font: { size: 11 } }, border: { color: line } } },
    }, extra);
  }
  function mkChart(id, cfg) { const el = document.getElementById(id); if (!el) return; charts[id] = new Chart(el, cfg); }
  const moneyTick = (v) => money(v);

  // ---------------- small components ----------------
  const chip = (text, cls = "") => `<span class="chip ${cls}">${esc(text)}</span>`;
  const sevChip = { critical: "bad", warn: "warn", info: "acc", good: "good" };
  const alertsHtml = (list, withLink = true) => list.length ? `<div class="alerts">${list.map((f) => `
    <div class="alert ${f.sev}"><div><div class="t">${esc(f.title)}</div><div class="d">${esc(f.detail)}</div><div class="small muted" style="margin-top:4px">${esc(f.agent)}</div></div>
    ${withLink ? `<a class="btn sm" href="#${f.view}">Open</a>` : "<span></span>"}</div>`).join("")}</div>` : `<div class="empty">Nothing needs attention.</div>`;
  const rangeField = (key, label, min, max, step, val, suffix = "") => `<div class="field"><label for="f-${key}">${label}</label><div class="row"><input type="range" id="f-${key}" data-set="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><output data-out="${key}">${val}${suffix}</output></div></div>`;
  const numField = (key, label, val, attrs = "") => `<div class="field"><label for="f-${key}">${label}</label><input type="number" id="f-${key}" data-set="${key}" value="${val == null ? "" : val}" ${attrs}></div>`;
  const selField = (key, label, opts, val, cls = "data-set") => `<div class="field"><label for="f-${key}">${label}</label><select id="f-${key}" ${cls}="${key}" data-type="${typeof opts[0][0] === "number" ? "num" : "str"}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
  const uploadBtns = (kind) => { const origin = (st.clients.find((c) => c.id === st.clientId) || {}).origin;
    return `<div class="field"><span class="lab">Your data</span><div class="btns"><label class="btn sm file-btn">Upload CSV<input type="file" accept=".csv,.tsv,.txt,text/csv" data-upload="${kind}"></label><button class="btn sm" type="button" data-action="paste" data-kind="${kind}">Paste CSV</button>${st.source[kind] === "upload" && (origin === "sample" || kind !== "channels") ? `<button class="btn sm ghost" type="button" data-action="reset-data" data-kind="${kind}">${origin === "sample" ? "Use sample" : "Remove"}</button>` : ""}</div></div>`; };

  // ---------------- views ----------------
  const VIEW_IMPL = {};

  VIEW_IMPL.overview = {
    lead: "Four agents read this client's channel, keyword, audience and creative data and suggest changes. Switch clients from the menu at the top.",
    results() {
      const b = R.budget, kw = R.kw;
      const P = R.proposal, moved = E.sum(P.rows.map((r) => Math.max(0, r.recommended - r.current)));
      const fatList = R.fat.filter((f) => f.fatigued).sort((a, b2) => b2.drop - a.drop), fatigued = fatList.length;
      return `
      <div class="tiles">
        <div class="tile"><div class="k">Budget to reallocate</div><div class="v">${money(moved)}<span class="small muted">/day</span></div><div class="s">${spct(P.uplift)} modelled revenue · ${st.alloc ? (R.allocStale ? "plan out of date" : "plan up to date") : "not re-allocated yet"}</div></div>
        <div class="tile"><div class="k">Wasted keyword spend</div><div class="v">${money(kw.wasted)}</div><div class="s">${kw.rows.filter((r) => r.action === "negative").length} negatives suggested</div></div>
        <div class="tile"><div class="k">Creatives fatiguing</div><div class="v ${fatigued ? "down" : "up"}">${fatigued}</div><div class="s">${fatigued ? `Worst: ${esc(fatList[0].name)} (CTR ${spct(-fatList[0].drop, 0)})` : "All creatives holding up"}</div></div>
        <div class="tile"><div class="k">Audience segments</div><div class="v">${R.aud.empty ? "–" : R.aud.k}</div><div class="s">${R.aud.empty ? "No customer file uploaded" : `from ${int(st.audience.length)} customers`}</div></div>
      </div>
      <div class="grid g2">
        <section class="card"><div class="card-head"><h2>Needs your attention</h2><span class="small muted">${R.findings.length} items</span></div>${alertsHtml(R.findings)}</section>
        <section class="card"><div class="card-head"><h2>Channel efficiency</h2><span class="small muted">Average ROAS now vs return on the next dollar</span></div><div class="chart-box tall"><canvas id="ch-ov"></canvas></div></section>
      </div>`;
    },
    charts() {
      const rows = R.budget.rows.filter((r) => r.enabled);
      mkChart("ch-ov", { type: "bar", data: { labels: rows.map((r) => r.label), datasets: [
        { label: "ROAS now", data: rows.map((r) => r.roasNow), backgroundColor: cssv("--c1") },
        { label: "Marginal ROAS at recommended spend", data: rows.map((r) => r.marginal), backgroundColor: cssv("--c4") }] },
        options: baseOpts({ indexAxis: "y", scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, callback: (v) => `${v}x` } }, y: baseOpts().scales.y } }) });
    },
  };

  VIEW_IMPL.budget = {
    lead: "Shows how each channel has performed since its start date. Press Re-allocate to get new daily amounts within your min and max per channel. Channels with better returns get more; channels whose creatives are wearing out get less.",
    controls() {
      const now = R.budget.spendNow || 1000, lo = Math.max(50, Math.round(now * 0.4 / 50) * 50), hi = Math.round(now * 2.2 / 50) * 50;
      const tot = Math.round(R.proposal.budget);
      return `
        <div class="field"><label for="f-since">Performance from</label><div class="row"><input type="date" id="f-since" data-set="since" data-type="str" value="${st.s.since || ""}" min="${firstDate()}" max="${lastDate()}"><button class="btn sm" type="button" data-action="since-start">Each campaign's start</button></div></div>
        <div class="field"><label for="f-total">Total daily budget</label><div class="row"><input type="range" id="f-total" data-set="total" min="${lo}" max="${hi}" step="50" value="${tot}"><input type="number" id="f-total-n" data-set="total" value="${tot}" step="50" aria-label="Total daily budget amount"><button class="btn sm" type="button" data-action="budget-reset">Current spend</button></div></div>
        ${rangeField("fatigueWeight", "Creative fatigue penalty", 0, 100, 10, st.s.fatigueWeight, "%")}
        ${numField("targetRoas", "Target ROAS (optional)", st.s.targetRoas, 'step="0.1" min="0" placeholder="none"')}
        <div class="field"><span class="lab">Daily change limit</span><label class="row" style="font-size:13px"><span class="switch"><input type="checkbox" id="f-limit" data-set="limitShift" ${st.s.limitShift ? "checked" : ""}><span></span></span>Limit each move per run</label></div>
        ${rangeField("maxShift", "Max change per run", 5, 100, 5, st.s.maxShift, "%")}
        ${rangeField("lowConfShift", "Max change, uncertain curves", 0, 50, 5, st.s.lowConfShift, "%")}
        ${selField("lookback", "Current daily spend = average of", [[7, "Last 7 days"], [14, "Last 14 days"], [28, "Last 28 days"]], st.s.lookback)}
        ${uploadBtns("channels")}`;
    },
    results() {
      if (!st.channels.length) return `<div class="empty">No ad spend found for ${esc(clientName())} in the synced period. Check that its accounts have active campaigns, or upload a CSV.</div>`;
      const b = R.budget, P = R.proposal, A = st.alloc;
      const perfRows = st.channels.map((c, i) => {
        const p = R.perf[c.id], f = R.fatByCh[c.id];
        const fatChip = !f.count ? chip("no creative data") : f.index >= 0.2 ? chip(`CTR −${(f.index * 100).toFixed(0)}%`, "bad") : f.index >= 0.05 ? chip(`CTR −${(f.index * 100).toFixed(0)}%`, "warn") : chip("Healthy", "good");
        return `<tr class="${c.enabled ? "" : "off"}">
          <td><span style="display:inline-flex;align-items:center;gap:8px"><span class="dot" style="background:${colorAt(i)}"></span><strong>${esc(c.label)}</strong></span></td>
          <td class="mono">${fmtDate(c.start)}</td>
          <td class="n">${p.days}</td>
          <td class="n">${money(p.spend)}</td><td class="n">${money(p.revenue)}</td><td class="n">${int(p.conv)}</td>
          <td class="n"><strong>${x2(p.roas)}</strong></td><td class="n">${money(p.cpa, 2)}</td>
          <td class="n">${x2(p.roas7)} ${p.trend7 == null ? "" : chip(spct(p.trend7, 0), p.trend7 > 0.03 ? "good" : p.trend7 < -0.03 ? "bad" : "")}</td>
          <td>${fatChip}${f.worst ? `<div class="small muted">${esc(f.worst.name)}${f.fatigued ? ` · ${f.fatigued} fatigued` : ""}</div>` : ""}</td></tr>`;
      }).join("");
      const tot = Object.values(R.perf).reduce((a, p) => ({ spend: a.spend + p.spend, revenue: a.revenue + p.revenue, conv: a.conv + p.conv }), { spend: 0, revenue: 0, conv: 0 });

      const status = !A ? `<span class="chip warn">Not run yet</span> <span class="small muted">Recommended amounts appear after you press Re-allocate.</span>`
        : R.allocStale ? `<span class="chip warn">Out of date</span> <span class="small muted">Last run ${esc(A.at)}. Inputs have changed since then.</span>`
        : `<span class="chip good">Up to date</span> <span class="small muted">Last run ${esc(A.at)}</span>`;
      const preview = R.allocStale ? `<span class="small">Re-allocating now: <strong class="mono ${P.revNew >= b.revNew ? "up" : "down"}">${spct(b.revNew ? P.revNew / b.revNew - 1 : 0)}</strong> modelled revenue vs ${A ? "the current plan" : "today's split"}</span>` : "";

      const rows = b.rows.map((r, i) => {
        const c = st.channels.find((x) => x.id === r.id), p = R.perf[r.id];
        const dc = !A ? chip("–") : Math.abs(r.delta) < 0.02 ? chip("hold") : chip(spct(r.delta, 0), r.delta > 0 ? "good" : "bad");
        const bound = A && r.boundBy && Math.abs((A.amounts[r.id] || 0) - r.proposed) < 1 ? chip({ max: "at max", min: "at min", shift: "change limit" }[r.boundBy], "acc") : "";
        return `<tr class="clickable ${st.selCh === r.id ? "sel" : ""} ${r.enabled ? "" : "off"}" data-action="sel-ch" data-id="${esc(r.id)}">
          <td><label class="switch" title="Include channel"><input type="checkbox" id="en-${esc(r.id)}" data-ch="${esc(r.id)}" data-f="enabled" ${r.enabled ? "checked" : ""} aria-label="Include ${esc(r.label)}"><span></span></label></td>
          <td><span style="display:inline-flex;align-items:center;gap:8px"><span class="dot" style="background:${colorAt(i)}"></span><strong>${esc(r.label)}</strong></span>${R.anoms.some((a) => a.id === r.id && a.freeze) ? " " + chip("anomaly", "bad") : ""}</td>
          <td><input type="number" id="min-${esc(r.id)}" data-ch="${esc(r.id)}" data-f="min" value="${c.min}" min="0" step="50" aria-label="Minimum daily budget for ${esc(r.label)}"></td>
          <td><input type="number" id="max-${esc(r.id)}" data-ch="${esc(r.id)}" data-f="max" value="${c.max}" min="0" step="50" aria-label="Maximum daily budget for ${esc(r.label)}"></td>
          <td class="n">${money(r.current)}</td>
          <td class="n"><strong style="font-size:15px">${money(r.recommended)}</strong>${bound ? `<div>${bound}</div>` : ""}</td>
          <td>${dc}</td>
          <td class="n">${x2(p.roas)}</td>
          <td class="n">${x2(r.effMarginal)}${r.penalty < 0.995 ? `<div class="small muted">${x2(r.marginal)} before fatigue</div>` : ""}</td>
          <td><div class="why">${esc(r.reason)}</div></td></tr>`;
      }).join("");
      const minSum = E.sum(st.channels.filter((c) => c.enabled).map((c) => c.min)), maxSum = E.sum(st.channels.filter((c) => c.enabled).map((c) => c.max));
      const sel = b.rows.find((r) => r.id === st.selCh) || b.rows[0];
      const sinceTxt = st.s.since ? `${fmtDate(st.s.since)} (or campaign start, if later)` : "each campaign's start date";
      const metricOpts = [["roas_cum", "Cumulative ROAS"], ["roas7", "ROAS, 7-day average"], ["spend7", "Daily spend, 7-day average"], ["rev_cum", "Cumulative revenue"]];
      const anomHtml = R.anoms.map((a) => `<div class="alert ${a.severity}"><div><div class="t">${esc(a.label)}: ${esc(a.title.toLowerCase())}</div><div class="d">${esc(a.detail)}${a.freeze ? " That day is left out when fitting this channel's curve." : ""}</div></div><span></span></div>`).join("");
      return `${anomHtml ? `<div class="alerts">${anomHtml}</div>` : ""}
      <section class="card"><div class="card-head"><h2>Performance since start</h2><span class="small muted">From ${esc(sinceTxt)} to ${fmtDate(lastDate())}</span></div>
        <div class="table-wrap"><table><thead><tr><th>Channel</th><th>Start date</th><th class="n">Days</th><th class="n">Spend</th><th class="n">Revenue</th><th class="n">Conv.</th><th class="n">ROAS</th><th class="n">CPA</th><th class="n">Last 7 days</th><th>Creative fatigue</th></tr></thead>
        <tbody>${perfRows}<tr><td><strong>All channels</strong></td><td></td><td></td><td class="n"><strong>${money(tot.spend)}</strong></td><td class="n"><strong>${money(tot.revenue)}</strong></td><td class="n">${int(tot.conv)}</td><td class="n"><strong>${x2(tot.spend ? tot.revenue / tot.spend : 0)}</strong></td><td class="n">${money(tot.conv ? tot.spend / tot.conv : null, 2)}</td><td></td><td></td></tr></tbody></table></div>
      </section>
      <section class="card"><div class="card-head"><h2>Performance over time</h2>
        <div class="field" style="min-width:220px"><label for="f-perfMetric" class="sr-only" style="position:absolute;left:-9999px">Metric</label><select id="f-perfMetric" data-set="perfMetric" data-type="str">${metricOpts.map(([v, t]) => `<option value="${v}" ${st.s.perfMetric === v ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
        <div class="chart-box tall"><canvas id="ch-perf"></canvas></div>
      </section>
      <section class="card" id="realloc">
        <div class="card-head"><div><h2>Budget re-allocation</h2><div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">${status}</div></div>
          <div class="btns" style="align-items:center">${preview}<button class="btn primary" type="button" data-action="reallocate">Re-allocate budget</button>${A ? `<button class="btn" type="button" data-action="export-budgets">Export new budgets</button><button class="btn ghost" type="button" data-action="clear-alloc">Back to current spend</button>` : ""}</div></div>
        ${A ? `<div class="banner ${b.uplift > 0.001 ? "good" : ""}" style="margin-bottom:12px"><span class="big">New plan: ${money(b.budget)}/day</span><span class="mono">modelled revenue ${money(b.revNow)} → ${money(b.revNew)} per day (${spct(b.uplift)})</span><span class="small muted">Blended ROAS ${x2(b.spendNow ? b.revNow / b.spendNow : 0)} → ${x2(b.budget ? b.revNew / b.budget : 0)} · fatigue penalty ${A.fatigueWeight}% · ${A.limitShift ? `moves limited to ±${A.maxShift}%` : "only min/max limits"}</span></div>` : ""}
        ${b.notes.map((n) => `<div class="alert warn" style="margin-bottom:10px"><div><div class="t">Note</div><div class="d">${esc(n)}</div></div><span></span></div>`).join("")}
        ${R.proposal.budget < minSum - 1 ? `<div class="alert warn" style="margin-bottom:10px"><div><div class="t">Minimums exceed budget</div><div class="d">Channel minimums add up to ${money(minSum)}/day, more than the ${money(R.proposal.budget)} budget.</div></div><span></span></div>` : ""}
        <div class="table-wrap"><table><thead><tr><th>On</th><th>Channel</th><th>Min/day</th><th>Max/day</th><th class="n">Current/day</th><th class="n">New amount/day</th><th>Change</th><th class="n">ROAS since start</th><th class="n">Next-dollar ROAS</th><th>Why</th></tr></thead><tbody>${rows}
          <tr><td></td><td><strong>Total</strong></td><td class="mono small">${money(minSum)}</td><td class="mono small">${money(maxSum)}</td><td class="n"><strong>${money(b.spendNow)}</strong></td><td class="n"><strong style="font-size:15px">${money(b.budget)}</strong></td><td></td><td></td><td></td><td></td></tr></tbody></table></div>
        <p class="small muted" style="margin-top:10px">Edit min and max, then press Re-allocate. Next-dollar ROAS is the modelled return on one more ${st.currency} at the new amount, discounted for creative fatigue.</p>
      </section>
      <div class="grid g2">
        <section class="card"><div class="card-head"><h2>Current vs new amount</h2><span class="small muted">per day</span></div><div class="chart-box tall"><canvas id="ch-alloc"></canvas></div></section>
        <section class="card"><div class="card-head"><h2>${esc(sel.label)} response curve</h2><span class="small muted">Click a channel row to switch</span></div><div class="chart-box tall"><canvas id="ch-curve"></canvas></div></section>
      </div>`;
    },
    charts() {
      if (!st.channels.length) return;
      // performance over time
      const from = st.s.since && st.s.since > firstDate() ? st.s.since : firstDate(), to = lastDate();
      const n = E.dayDiff(from, to) + 1, labels = Array.from({ length: n }, (_, i) => E.addDays(from, i));
      const metric = st.s.perfMetric;
      const ds = st.channels.map((c, ci) => {
        const w = E.windowed(c, st.s.since), idx = Object.fromEntries(w.dates.map((d, i) => [d, i]));
        let cs = 0, cr = 0;
        const data = labels.map((d) => {
          const i = idx[d]; if (i == null) return null;
          cs += w.spend[i]; cr += w.revenue[i];
          if (metric === "roas_cum") return cs ? cr / cs : null;
          if (metric === "rev_cum") return cr;
          const a = Math.max(0, i - 6), sp = E.sum(w.spend.slice(a, i + 1)), rv = E.sum(w.revenue.slice(a, i + 1));
          return metric === "roas7" ? (sp ? rv / sp : null) : sp / (i + 1 - a);
        });
        return { label: c.label, data, borderColor: colorAt(ci), backgroundColor: colorAt(ci), borderWidth: 2, pointRadius: 0, tension: 0.25, spanGaps: false };
      });
      const isMoney = metric === "spend7" || metric === "rev_cum";
      mkChart("ch-perf", { type: "line", data: { labels: labels.map((d) => fmtDate(d).replace(/ \d{4}$/, "")), datasets: ds },
        options: baseOpts({ interaction: { mode: "index", intersect: false }, plugins: { ...baseOpts().plugins, tooltip: { mode: "index", intersect: false, callbacks: { label: (c) => `${c.dataset.label}: ${isMoney ? money(c.parsed.y) : x2(c.parsed.y)}` } } },
          scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxTicksLimit: 10 } }, y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => (isMoney ? money(v) : `${(+v).toFixed(1)}x`) } } } }) });

      const rows = R.budget.rows;
      mkChart("ch-alloc", { type: "bar", data: { labels: rows.map((r) => r.label), datasets: [
        { label: "Current", data: rows.map((r) => r.current), backgroundColor: alpha(cssv("--ink-2"), 0.45) },
        { label: st.alloc ? "New amount" : "New amount (press Re-allocate)", data: rows.map((r) => r.recommended), backgroundColor: rows.map((_, i) => colorAt(i)) },
        { label: "Max", data: rows.map((r) => st.channels.find((c) => c.id === r.id).max), type: "scatter", pointStyle: "line", pointRadius: 9, borderColor: cssv("--ink"), borderWidth: 2, backgroundColor: cssv("--ink") }] },
        options: baseOpts({ indexAxis: "y", scales: { x: { ...baseOpts().scales.x, max: Math.max(...rows.map((r) => Math.max(r.current, r.recommended))) * 1.6, ticks: { ...baseOpts().scales.x.ticks, callback: moneyTick } }, y: baseOpts().scales.y } }) });
      const i = Math.max(0, rows.findIndex((r) => r.id === st.selCh)), r = rows[i], col = colorAt(i);
      const xmax = Math.max(...r.spend, r.recommended, r.current) * 1.3;
      const line = Array.from({ length: 61 }, (_, k) => { const x = (xmax * k) / 60; return { x, y: E.curveRev(r.fit, x) }; });
      mkChart("ch-curve", { type: "scatter", data: { datasets: [
        { label: "Observed days", data: r.spend.map((s, k) => ({ x: s, y: r.revenue[k] })), backgroundColor: alpha(col, 0.35), pointRadius: 3 },
        { label: "Fitted curve", data: line, showLine: true, borderColor: col, borderWidth: 2, pointRadius: 0 },
        { label: "Current", data: [{ x: r.current, y: E.curveRev(r.fit, r.current) }], backgroundColor: cssv("--surface"), borderColor: cssv("--ink"), borderWidth: 2, pointRadius: 7 },
        { label: "New amount", data: [{ x: r.recommended, y: E.curveRev(r.fit, r.recommended) }], backgroundColor: col, borderColor: cssv("--ink"), borderWidth: 2, pointRadius: 7, pointStyle: "rectRot" }] },
        options: baseOpts({ scales: { x: { ...baseOpts().scales.x, min: 0, max: xmax, title: { display: true, text: "Spend per day", color: cssv("--ink-2") }, ticks: { ...baseOpts().scales.x.ticks, callback: moneyTick } }, y: { ...baseOpts().scales.y, min: 0, title: { display: true, text: "Revenue per day", color: cssv("--ink-2") }, ticks: { ...baseOpts().scales.y.ticks, callback: moneyTick } } } }) });
    },
  };

  VIEW_IMPL.keywords = {
    lead: "Groups search terms into themes and classifies intent. Each keyword gets an action against your target CPA: add as a negative, raise the bid, lower the bid, keep, or watch.",
    controls() {
      const intents = ["all", "transactional", "commercial", "informational", "low_intent"];
      return `
        ${numField("targetCpa", `Target CPA (${st.currency})`, st.s.targetCpa, 'min="1" step="1"')}
        ${numField("minClicks", "Min clicks to judge", st.s.minClicks, 'min="0" step="10"')}
        ${rangeField("nThemes", "Themes", 2, 8, 1, st.s.nThemes)}
        <div class="field"><span class="lab">Intent</span><div class="btns">${intents.map((x) => `<button type="button" class="chip chip-toggle" data-action="kw-intent" data-v="${x}" aria-pressed="${st.kwIntent === x}">${nice(x)}</button>`).join("")}</div></div>
        ${selField("kwAction", "Action", [["all", "All actions"], ["negative", "Add negative"], ["raise_bid", "Raise bid"], ["lower_bid", "Lower bid"], ["keep", "Keep"], ["watch", "Watch"]], st.kwAction, "data-state")}
        <div class="field"><label for="f-kwq">Search</label><input type="search" id="f-kwq" data-state="kwQuery" data-type="str" data-live="1" value="${esc(st.kwQuery)}" placeholder="Filter keywords"></div>
        ${uploadBtns("keywords")}`;
    },
    results() {
      if (R.kw.empty) return `<div class="empty">No search terms for ${esc(clientName())}. Search terms come from Google Ads Search campaigns; this client has none in the last 30 days. You can upload a search terms CSV instead.</div>`;
      const kw = R.kw, s = st.kwSort;
      let rows = kw.rows.filter((r) => (st.kwIntent === "all" || r.intent === st.kwIntent) && (st.kwAction === "all" || r.action === st.kwAction) && (st.kwTheme == null || r.theme === st.kwTheme) && (!st.kwQuery || r.text.toLowerCase().includes(st.kwQuery.toLowerCase())));
      rows = rows.sort((a, b) => { const va = a[s.key], vb = b[s.key]; if (va == null) return 1; if (vb == null) return -1; return (typeof va === "string" ? va.localeCompare(vb) : va - vb) * s.dir; });
      const actChip = { negative: ["Add negative", "bad"], raise_bid: ["Raise bid", "good"], lower_bid: ["Lower bid", "warn"], keep: ["Keep", ""], watch: ["Watch", "acc"] };
      const intChip = { transactional: "good", commercial: "acc", informational: "", low_intent: "bad" };
      const th = (key, label, n) => `<th class="sortable ${n ? "n" : ""}" data-action="kw-sort" data-k="${key}" aria-sort="${s.key === key ? (s.dir > 0 ? "ascending" : "descending") : "none"}">${label}${s.key === key ? (s.dir > 0 ? " ↑" : " ↓") : ""}</th>`;
      const totConv = E.sum(kw.rows.map((r) => r.conversions)), totCost = E.sum(kw.rows.map((r) => r.cost));
      const themeName = (id) => (kw.themes.find((t) => t.id === id) || { name: "–" }).name;
      return `
      <div class="tiles">
        <div class="tile"><div class="k">Wasted spend</div><div class="v down">${money(kw.wasted)}</div><div class="s">on ${kw.rows.filter((r) => r.action === "negative").length} keywords to negate</div></div>
        <div class="tile"><div class="k">Scale up</div><div class="v up">${kw.rows.filter((r) => r.action === "raise_bid").length}</div><div class="s">keywords well under target CPA</div></div>
        <div class="tile"><div class="k">Scale down</div><div class="v">${kw.rows.filter((r) => r.action === "lower_bid").length}</div><div class="s">keywords over target CPA</div></div>
        <div class="tile"><div class="k">Account CPA</div><div class="v">${money(totConv ? totCost / totConv : null, 2)}</div><div class="s">target ${money(st.s.targetCpa)}</div></div>
      </div>
      <section class="card"><div class="card-head"><h2>Themes</h2>${st.kwTheme != null ? `<button class="btn sm" type="button" data-action="kw-theme" data-v="">Show all themes</button>` : `<span class="small muted">Click a theme to filter</span>`}</div>
        <div class="grid g4">${kw.themes.map((t) => `<button type="button" class="card" data-action="kw-theme" data-v="${t.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit;${st.kwTheme === t.id ? "border-color:var(--accent);background:var(--accent-soft)" : ""}">
          <div style="font-weight:650">${esc(t.name)}</div>
          <dl class="kv" style="margin:8px 0 0"><dt>Keywords</dt><dd>${t.count}</dd><dt>Cost</dt><dd>${money(t.cost)}</dd><dt>CPA</dt><dd class="${t.cpa && t.cpa > st.s.targetCpa ? "down" : "up"}">${money(t.cpa, 2)}</dd><dt>ROAS</dt><dd>${x2(t.roas)}</dd></dl></button>`).join("")}</div>
      </section>
      <section class="card"><div class="card-head"><h2>Keywords <span class="muted small">(${rows.length} shown)</span></h2>
        <div class="btns"><button class="btn sm" type="button" data-action="copy-negatives">Copy negative list</button><button class="btn sm" type="button" data-action="export-kw">Export actions CSV</button></div></div>
        <div class="table-wrap"><table><thead><tr>${th("text", "Keyword")}${th("theme", "Theme")}${th("intent", "Intent")}${th("impressions", "Impr.", 1)}${th("clicks", "Clicks", 1)}${th("ctr", "CTR", 1)}${th("conversions", "Conv.", 1)}${th("cvr", "CVR", 1)}${th("cost", "Cost", 1)}${th("cpa", "CPA", 1)}${th("action", "Action")}<th>Why</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td><strong>${esc(r.text)}</strong></td><td class="small muted">${esc(themeName(r.theme))}</td><td>${chip(nice(r.intent), intChip[r.intent])}</td><td class="n">${int(r.impressions)}</td><td class="n">${int(r.clicks)}</td><td class="n">${pct(r.ctr, 2)}</td><td class="n">${r.conversions.toFixed(1)}</td><td class="n">${pct(r.cvr, 2)}</td><td class="n">${money(r.cost)}</td><td class="n ${r.cpa && r.cpa > st.s.targetCpa ? "down" : ""}">${money(r.cpa, 2)}</td><td>${chip(...actChip[r.action])}</td><td><div class="why">${esc(r.why)}</div></td></tr>`).join("") || `<tr><td colspan="12"><div class="empty">No keywords match these filters.</div></td></tr>`}</tbody></table></div>
      </section>`;
    },
  };

  VIEW_IMPL.audiences = {
    lead: "Clusters customers on recency, frequency, spend, age and engagement. It picks the number of segments with the best separation, then names each segment and gives it a targeting play.",
    controls() {
      const f = E.AUD_FEATURES.map((x) => [x, E.AUD_LABELS[x]]);
      return `${selField("audK", "Segments", [[0, "Auto (best fit)"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]], st.s.audK)}
        ${selField("ax", "Chart X axis", f, st.s.ax)}${selField("ay", "Chart Y axis", f, st.s.ay)}${uploadBtns("audience")}`;
    },
    results() {
      const a = R.aud;
      if (a.empty) return `<div class="empty">No customer file for ${esc(clientName())} yet. Upload a CSV with one row per customer (columns ${esc(E.AUD_FEATURES.join(", "))}, optional customer_id) to see segments.</div>`;
      const note = st.source.audience === "sample" ? `<div class="alert info"><div><div class="t">Sample customers</div><div class="d">Customer data doesn't come from Google or Meta. These are generated customers. Upload ${esc(clientName())}'s customer export (one row per customer) to segment real customers.</div></div><span></span></div>` : "";
      const scores = Object.entries(a.scores).map(([k, v]) => `${k} segments: ${v.toFixed(2)}`).join(" · ");
      return `
      ${note}<div class="banner"><span class="big">${a.k} segments from ${int(st.audience.length)} customers</span><span class="muted small">Separation (silhouette, higher is better): ${scores}</span></div>
      <div class="grid g2">
        <section class="card span2"><div class="card-head"><h2>Segment map</h2><span class="small muted">${esc(E.AUD_LABELS[st.s.ax])} vs ${esc(E.AUD_LABELS[st.s.ay])}</span></div><div class="chart-box tall"><canvas id="ch-aud"></canvas></div></section>
      </div>
      <div class="grid g4">${a.segments.map((sg) => `
        <section class="card seg-card" style="border-top-color:${colorAt(sg.id)}">
          <div class="card-head" style="margin:0"><h2>${esc(sg.name)}</h2>${chip(pct(sg.share, 0))}</div>
          <dl class="kv" style="margin:0">${E.AUD_FEATURES.map((f) => `<dt>${esc(E.AUD_LABELS[f])}</dt><dd>${f === "monetary" ? money(sg.profile[f]) : sg.profile[f].toFixed(1)}</dd>`).join("")}<dt>Customers</dt><dd>${int(sg.size)}</dd></dl>
          <p style="font-size:13px"><strong>Play:</strong> ${esc(sg.play)}</p>
          <div class="btns"><button class="btn sm" type="button" data-action="seg-ideas" data-name="${esc(sg.name)}">Write ads for this segment</button></div>
        </section>`).join("")}</div>`;
    },
    charts() {
      const a = R.aud, xi = E.AUD_FEATURES.indexOf(st.s.ax), yi = E.AUD_FEATURES.indexOf(st.s.ay);
      mkChart("ch-aud", { type: "scatter", data: { datasets: a.segments.map((sg) => ({ label: sg.name, data: st.audience.map((r, i) => (a.labels[i] === sg.id ? { x: r[xi], y: r[yi] } : null)).filter(Boolean), backgroundColor: alpha(colorAt(sg.id), 0.55), pointRadius: 3 })) },
        options: baseOpts({ scales: { x: { ...baseOpts().scales.x, title: { display: true, text: E.AUD_LABELS[st.s.ax], color: cssv("--ink-2") } }, y: { ...baseOpts().scales.y, title: { display: true, text: E.AUD_LABELS[st.s.ay], color: cssv("--ink-2") } } } }) });
    },
  };

  const fatShown = () => R.fat.filter((f) => st.creativeCh === "all" || f.channel === st.creativeCh);
  VIEW_IMPL.creative = {
    lead: "Learns which hooks, CTAs and formats convert, spots creatives that are wearing out, and suggests what to test next. Claude can write the ad copy.",
    results() {
      const eff = R.effects;
      const varNote = !st.variants.length ? `<div class="alert info"><div><div class="t">No creative breakdown yet</div><div class="d">Format and call-to-action results need Meta or video ads with at least 1,000 impressions.</div></div><span></span></div>`
        : st.variants.every((v) => v.hook === "untagged") ? `<div class="alert info"><div><div class="t">Hooks aren't tagged</div><div class="d">Google and Meta report each ad's format and call to action, but not its hook (urgency, social proof and so on), so the hook card shows one untagged group.${st.variantMetric === "clicks" ? " No conversions were recorded, so rates below use clicks." : ""}</div></div><span></span></div>` : "";
      const effCard = (attr, title) => `<section class="card"><div class="card-head"><h2>${title}</h2></div>${eff[attr].map((e, i) => `
        <div style="display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
          <div><div style="font-weight:600">${esc(nice(e.value))}</div><div class="bar" style="margin-top:4px"><span style="width:${(e.rate / eff[attr][0].rate * 100).toFixed(1)}%;${i === 0 ? "" : "background:var(--ink-2);opacity:.5"}"></span></div></div>
          <span class="mono small">${pct(e.rate, 2)}</span>${chip(spct(e.lift, 0), e.lift > 0.02 ? "good" : e.lift < -0.02 ? "bad" : "")}</div>`).join("")}</section>`;
      const form = st.ideaForm;
      const segs = ["All customers", ...R.aud.segments.map((s) => s.name)];
      const ideas = st.ideas.map((d, i) => `<section class="card idea">
        <div class="meta">${chip(nice(d.hook || "–"), "acc")}${chip(nice(d.format || "–"))}${chip(d.cta || "–")}${d.platform ? chip(d.platform) : ""}</div>
        <div class="hl">${esc(d.headline)}</div><div class="pt">${esc(d.primary_text || "")}</div>
        ${d.rationale ? `<p class="small muted">${esc(d.rationale)}</p>` : ""}
        <div class="btns"><button class="btn sm" type="button" data-action="copy-idea" data-i="${i}">Copy</button></div></section>`).join("");
      return `${varNote}
      <div class="grid g3">${effCard("hook", "Hook")}${effCard("cta", "Call to action")}${effCard("format", "Format")}</div>
      <div class="grid g2">
        <section class="card"><div class="card-head"><h2>Creative fatigue</h2>
          <div class="btns"><select id="f-creativeCh" data-state="creativeCh" data-type="str" aria-label="Channel">${[["all", "All channels"], ...st.channels.map((c) => [c.id, c.label])].map(([v, t]) => `<option value="${esc(v)}" ${st.creativeCh === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
          <label class="btn sm file-btn">Upload CSV<input type="file" accept=".csv,text/csv" data-upload="creatives"></label><button class="btn sm" type="button" data-action="paste" data-kind="creatives">Paste CSV</button></div></div>
          <p class="small muted" style="margin-bottom:8px">Daily CTR. Fatigue lowers a channel's share when you re-allocate budget.</p>
          <div class="chart-box"><canvas id="ch-fat"></canvas></div>
          <div class="alerts" style="margin-top:12px">${fatShown().map((f) => `<div class="alert ${f.fatigued ? "warn" : "good"}"><div><div class="t">${esc(f.name)} <span class="small muted">· ${esc(chLabel(f.channel))}</span></div><div class="d">CTR ${pct(f.first, 2)} → ${pct(f.last, 2)} (${spct(-f.drop, 0)}). ${f.fatigued ? "Rotate in a fresh variant." : "Holding up."}</div></div><span></span></div>`).join("") || '<div class="empty">No creatives for this channel.</div>'}</div></section>
        <section class="card"><div class="card-head"><h2>Next combinations to test</h2><span class="small muted">Built from the winning hooks, CTAs and formats, none tested yet</span></div>
          ${R.combos.length ? `<div class="table-wrap"><table><thead><tr><th>Hook</th><th>CTA</th><th>Format</th><th class="n">Expected lift</th></tr></thead><tbody>${R.combos.map((c, i) => `<tr><td>${esc(nice(c.hook))}</td><td>${esc(c.cta)}</td><td>${esc(nice(c.format))}</td><td class="n">${spct(c.score, 0)}</td></tr>`).join("")}</tbody></table></div>
          <p class="small muted" style="margin-top:8px">Expected lift adds up each attribute's observed lift. Treat it as a ranking, not a forecast.</p>` : `<div class="empty">Every combination of the top attributes has been tested.</div>`}
        </section>
      </div>
      <section class="card"><div class="card-head"><h2>Ad copy generator</h2><span class="small muted" id="gen-status">${hasKey() ? "Writes with Claude using your own API key, stored only in this browser" : "Add your Anthropic API key to write with Claude; templates work without it"}</span></div>
        <div class="controls">
          <div class="field" style="flex:1 1 220px"><label for="if-product">Product or offer</label><input type="text" id="if-product" data-form="product" value="${esc(form.product)}" placeholder="e.g. plant-based meal plans for diabetics"></div>
          <div class="field"><label for="if-aud">Audience segment</label><select id="if-aud" data-form="audience">${segs.map((s) => `<option ${s === form.audience ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
          <div class="field"><label for="if-plat">Platform</label><select id="if-plat" data-form="platform">${PLATFORMS.map((p) => `<option ${p === form.platform ? "selected" : ""}>${p}</option>`).join("")}</select></div>
          <div class="field"><label for="if-tone">Tone</label><input type="text" id="if-tone" data-form="tone" value="${esc(form.tone)}"></div>
          <div class="field" style="flex:1 1 240px"><label for="if-notes">Facts Claude may use (offers, proof points)</label><input type="text" id="if-notes" data-form="notes" value="${esc(form.notes)}" placeholder="e.g. 14-day free trial; 4.7★ from 2,100 reviews"></div>
        </div>
        <div class="btns" style="margin-top:14px">
          <button class="btn primary" type="button" data-action="gen-ideas" ${!hasKey() || generating ? "disabled" : ""}>${generating ? '<span class="spinner"></span> Writing…' : "Write 6 ads with Claude"}</button>
          <button class="btn" type="button" data-action="template-ideas">Use templates instead</button>
          <button class="btn ghost" type="button" data-action="api-key">${hasKey() ? "Change API key" : "Add API key"}</button>
          ${st.ideas.length ? `<button class="btn ghost" type="button" data-action="clear-ideas">Clear</button>` : ""}
        </div>
        ${st.ideaSource === "template" && st.ideas.length ? `<p class="small muted" style="margin-top:10px">Template ideas contain [placeholders]. Fill them with real, verifiable claims before launch.</p>` : ""}
      </section>
      ${st.ideas.length ? `<div class="grid g3">${ideas}</div>` : ""}`;
    },
    charts() {
      const shown = fatShown(); const n = Math.max(0, ...shown.map((f) => f.ctr.length));
      const ref = shown.find((f) => f.ctr.length === n && f.dates);
      const labels = ref ? ref.dates.map((d) => fmtDate(d).replace(/ \d{4}$/, "")) : Array.from({ length: n }, (_, i) => `D${i + 1}`);
      mkChart("ch-fat", { type: "line", data: { labels, datasets: shown.map((f) => { const ci = Math.max(0, st.channels.findIndex((c) => c.id === f.channel)); const pad = Array(n - f.ctr.length).fill(null); return { label: f.name, data: [...pad, ...f.ctr], borderColor: colorAt(ci), backgroundColor: colorAt(ci), borderWidth: f.fatigued ? 2.5 : 1.3, borderDash: f.fatigued ? [] : [4, 3], pointRadius: 0, tension: 0.3 }; }) },
        options: baseOpts({ plugins: { ...baseOpts().plugins, legend: { ...baseOpts().plugins.legend, display: shown.length <= 6 } }, scales: { x: { ...baseOpts().scales.x, ticks: { ...baseOpts().scales.x.ticks, maxTicksLimit: 7 } }, y: { ...baseOpts().scales.y, ticks: { ...baseOpts().scales.y.ticks, callback: (v) => pct(v, 1) } } } }) });
    },
  };

  // ---------------- actions ----------------
  const stamp = () => new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const logIt = (text) => { st.log.push({ text, at: stamp() }); if (st.log.length > 100) st.log.shift(); };
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }
  function modal(title, bodyHtml, actions = []) {
    $("#modal-title").textContent = title; $("#modal-body").innerHTML = bodyHtml;
    $("#modal-actions").innerHTML = actions.map((a, i) => `<button class="btn ${a.primary ? "primary" : ""}" type="button" data-modal="${i}">${esc(a.label)}</button>`).join("") + `<button class="btn ghost" type="button" data-modal="close">Close</button>`;
    modal.actions = actions; $("#modal").classList.add("open");
    const f = $("#modal-body textarea, #modal-body input") || $("#modal-actions button"); if (f) f.focus();
  }
  const closeModal = () => $("#modal").classList.remove("open");
  async function copyText(text, label = "Copied") {
    try { await navigator.clipboard.writeText(text); toast(label); }
    catch (e) { modal("Copy this text", `<textarea id="copy-area" readonly>${esc(text)}</textarea>`); const ta = $("#copy-area"); ta.select(); }
  }
  async function offerFile(filename, text) {
    try {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: /\.json$/.test(filename) ? "application/json" : "text/csv" }));
      a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast(`Downloaded ${filename}`); return true;
    } catch (e) {
      modal(`Export ${filename}`, `<p class="small muted" style="margin-bottom:8px">Copy the contents below and save them as <span class="mono">${esc(filename)}</span>.</p><textarea id="copy-area" readonly>${esc(text)}</textarea>`, [{ label: "Copy", primary: true, run: () => copyText(text) }]);
      return false;
    }
  }
  const KEY_STORE = "pmo-anthropic-key";
  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } };
  const hasKey = () => !!getKey();
  function keyDialog() {
    modal("Anthropic API key", `<p class="small muted" style="margin-bottom:8px">Used only to write ad copy. It is kept in this browser's storage and sent only to api.anthropic.com. Anyone using this browser profile can read it, so use a key with a spend limit.</p><input type="password" id="key-in" autocomplete="off" placeholder="sk-ant-..." value="${esc(getKey())}">`,
      [{ label: "Save key", primary: true, run: () => { try { const v = $("#key-in").value.trim(); if (v) localStorage.setItem(KEY_STORE, v); else localStorage.removeItem(KEY_STORE); } catch (e) { toast("Browser storage is blocked."); } renderResults(); } }]);
  }

  const TEMPLATES = {
    channels: { cols: "date,channel,spend,revenue", ex: "2026-10-01,Google Search,1450,3620\n2026-10-01,Meta,980,2510", hint: "One row per channel per day. Needs at least 8 days per channel." },
    keywords: { cols: "keyword,impressions,clicks,conversions,cost,revenue", ex: "buy running shoes,24000,960,38,1180,3420", hint: "Export the search terms report from Google Ads. Revenue is optional." },
    creatives: { cols: "date,channel,creative,impressions,clicks", ex: "2026-10-01,Meta,Summer sale carousel,42000,1430", hint: "Daily rows per ad creative, at least 8 days each. Channel names should match your budget channels." },
    audience: { cols: "recency_days,frequency,monetary,age,sessions_per_wk", ex: "12,3,95,34,4", hint: "One row per customer. At least 30 rows." },
  };
  function normDate(v) {
    if (!v) return null; const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; // DD/MM/YYYY
    const d = new Date(s); return isNaN(d) ? null : E.isoDay(d);
  }
  // ---- file parsing with de-duplication ----
  // 1) rows that are identical in every column are dropped; 2) rows describing the same thing
  // (same date+channel, same keyword, same creative+day) are combined by summing, never listed twice.
  function toCommaCSV(text) {
    text = String(text).replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0], cnt = (re) => (first.match(re) || []).length;
    const c = cnt(/,/g), sc = cnt(/;/g), t = cnt(/\t/g);
    if (c >= sc && c >= t) return text;
    const d = t >= sc ? "\t" : ";", out = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; out.push(row); row = []; }
      else f += ch;
    }
    if (f !== "" || row.length) { row.push(f); out.push(row); }
    return out.map((r) => r.map((x) => (/[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x)).join(",")).join("\n");
  }
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const pick = (r, ...ks) => { for (const k of ks) if (r[k] != null && String(r[k]).trim() !== "") return r[k]; return ""; };
  const slug = (n) => String(n).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  function readRows(text) {
    const rows = E.parseCSV(toCommaCSV(text)).filter((r) => Object.values(r).some((v) => String(v).trim() !== ""));
    const seen = new Set(), out = [];
    rows.forEach((r) => { const k = Object.keys(r).sort().map((x) => String(r[x]).trim().toLowerCase()).join("\u0001"); if (!seen.has(k)) { seen.add(k); out.push(r); } });
    return { rows: out, read: rows.length, exact: rows.length - out.length };
  }
  const PARSERS = {
    channels(text) {
      const { rows, read, exact } = readRows(text); const by = new Map(); let merged = 0, noDate = 0;
      rows.forEach((r) => {
        const name = String(pick(r, "channel", "source", "platform")).trim(); if (!name) return;
        const day = normDate(pick(r, "date", "day")); if (!day) { noDate++; return; }
        const id = slug(name); let g = by.get(id); if (!g) { g = { label: name, days: new Map() }; by.set(id, g); }
        let x = g.days.get(day); if (!x) { x = { spend: 0, revenue: 0, conversions: 0 }; g.days.set(day, x); } else merged++;
        x.spend += num(pick(r, "spend", "cost")); x.revenue += num(pick(r, "revenue", "conversion_value", "value", "conv_value")); x.conversions += num(pick(r, "conversions", "conv"));
      });
      if (!by.size) throw new Error("No usable rows. Expected columns: date, channel, spend, revenue.");
      if (noDate) throw new Error(`${noDate} rows have no readable date. Use YYYY-MM-DD or DD/MM/YYYY in a column called date.`);
      const warnings = [];
      const data = [...by.entries()].map(([id, g]) => {
        const days = [...g.days.keys()].sort(), spend = days.map((d) => g.days.get(d).spend);
        const gaps = E.dayDiff(days[0], days[days.length - 1]) + 1 - days.length; if (gaps > 0) warnings.push(`${g.label}: ${gaps} days between its first and last date have no row (left as they are, not filled).`);
        return { id, label: g.label, start: days[0], dates: days, spend, revenue: days.map((d) => g.days.get(d).revenue), conversions: days.map((d) => g.days.get(d).conversions), min: 0, max: Math.max(100, Math.round(Math.max(...spend) * 3)), enabled: true };
      });
      const thin = data.filter((c) => c.spend.filter((v) => v > 0).length < 8);
      if (thin.length) throw new Error(`${thin.map((c) => c.label).join(", ")}: needs at least 8 days with spend above zero.`);
      return { data, stats: { read, exact, merged, kept: data.reduce((a, c) => a + c.dates.length, 0) }, warnings };
    },
    keywords(text) {
      const { rows, read, exact } = readRows(text); const by = new Map(); let merged = 0;
      rows.forEach((r) => {
        const t = String(pick(r, "keyword", "search_term", "query")).trim(); if (!t) return; const key = t.toLowerCase();
        const k = by.get(key) || { text: t, impressions: 0, clicks: 0, conversions: 0, cost: 0, revenue: 0 }; if (by.has(key)) merged++;
        k.impressions += num(pick(r, "impressions", "impr")); k.clicks += num(r.clicks); k.conversions += num(pick(r, "conversions", "conv")); k.cost += num(pick(r, "cost", "spend")); k.revenue += num(pick(r, "revenue", "conversion_value", "conv_value")); by.set(key, k);
      });
      const data = [...by.values()]; if (data.length < 3) throw new Error("Need at least 3 different keywords, in a column called keyword (or search_term).");
      return { data, stats: { read, exact, merged, kept: data.length }, warnings: [] };
    },
    creatives(text, ctx) {
      const { rows, read, exact } = readRows(text); const chans = (ctx && ctx.channels) || [];
      const matchCh = (v) => { const t = String(v || "").toLowerCase(); const c = chans.find((x) => x.id === slug(t) || x.label.toLowerCase() === t || (t && t.includes(x.label.toLowerCase().split(" ")[0]))); return c ? c.id : slug(t); };
      const by = new Map(); let merged = 0, noDate = 0;
      rows.forEach((r) => {
        const name = String(pick(r, "creative", "ad", "ad_name")).trim(); if (!name) return;
        const day = normDate(pick(r, "date", "day")); if (!day) { noDate++; return; }
        const ch = matchCh(pick(r, "channel", "platform")), key = name.toLowerCase() + "|" + ch;
        let g = by.get(key); if (!g) { g = { name, channel: ch, days: new Map() }; by.set(key, g); }
        let x = g.days.get(day); if (!x) { x = { imp: 0, clk: 0, ctr: null }; g.days.set(day, x); } else merged++;
        const imp = num(pick(r, "impressions", "impr")); x.imp += imp; x.clk += num(r.clicks); if (!imp && pick(r, "ctr") !== "") { const c = num(r.ctr); x.ctr = c > 1 ? c / 100 : c; }
      });
      if (noDate) throw new Error(`${noDate} rows have no readable date. Columns needed: date, channel, creative, impressions, clicks.`);
      const names = {}; by.forEach((g) => (names[g.name.toLowerCase()] = (names[g.name.toLowerCase()] || 0) + 1));
      const data = [...by.values()].map((g) => { const days = [...g.days.keys()].sort(); return { name: names[g.name.toLowerCase()] > 1 ? `${g.name} (${(chans.find((c) => c.id === g.channel) || { label: g.channel }).label})` : g.name, channel: g.channel, dates: days, ctr: days.map((d) => { const x = g.days.get(d); return x.imp ? x.clk / x.imp : x.ctr || 0; }) }; }).filter((c) => c.ctr.length >= 8);
      if (!data.length) throw new Error("Need at least 8 days per creative with columns date, channel, creative, impressions, clicks.");
      return { data, stats: { read, exact, merged, kept: data.reduce((a, c) => a + c.dates.length, 0) }, warnings: [] };
    },
    audience(text) {
      const { rows, read, exact } = readRows(text); const idKey = ["customer_id", "id", "customer", "user_id"].find((k) => rows.some((r) => r[k] != null && String(r[k]).trim() !== ""));
      let merged = 0, list = rows;
      if (idKey) { const m = new Map(); rows.forEach((r) => { const id = String(r[idKey]).trim().toLowerCase(); if (id) { if (m.has(id)) merged++; m.set(id, r); } else m.set(Symbol(), r); }); list = [...m.values()]; }
      const data = list.map((r) => E.AUD_FEATURES.map((f) => num(r[f]))).filter((r) => r.some((v) => v));
      if (data.length < 30) throw new Error(`Need at least 30 different customers with columns ${E.AUD_FEATURES.join(", ")}.`);
      return { data, stats: { read, exact, merged, kept: data.length }, warnings: idKey ? [] : ["No customer_id column, so only rows identical in every column were treated as duplicates."] };
    },
  };
  // Put parsed data onto `t` (the live state, or a workspace being built).
  function applyParsed(t, kind, p, active) {
    if (kind === "channels") {
      t.channels = p.data; t.selCh = p.data[0].id; t.alloc = null;
      if (active) { st.s.total = null; st.s.since = null; } else { t.total = null; t.since = null; }
      if (t.source.creatives === "sample") t.creatives = E.sampleCreativeCtr(t.seed, p.data);
    } else if (kind === "creatives") t.creatives = p.data;
    else if (kind === "keywords") { t.keywords = p.data; t.kwTheme = null; if (active) st.s.nThemes = Math.min(st.s.nThemes, p.data.length); }
    else if (kind === "audience") { t.audience = p.data; if (active) audVersion++; }
    t.source[kind] = "upload";
  }
  function summaryText(kind, p) {
    const x = p.stats, bits = [`${int(x.kept)} ${kind === "channels" || kind === "creatives" ? "daily rows" : kind === "keywords" ? "keywords" : "customers"} loaded from ${int(x.read)} rows`];
    if (x.exact) bits.push(`${int(x.exact)} exact duplicate rows removed`);
    if (x.merged) bits.push(`${int(x.merged)} rows combined into existing ${kind === "keywords" ? "keywords" : kind === "audience" ? "customer ids" : "date entries"}`);
    return bits.join(". ") + ".";
  }
  function ingest(kind, text) {
    const p = PARSERS[kind](text, { channels: st.channels });
    applyParsed(st, kind, p, true);
    const msg = summaryText(kind, p); logIt(`${clientName()}: ${msg}`);
    R = compute(); renderView(); renderNav(); renderStrip(); save();
    if (p.warnings.length || p.stats.exact || p.stats.merged) modal("Data loaded", `<p>${esc(msg)}</p>${p.warnings.map((w) => `<p class="small muted" style="margin-top:8px">${esc(w)}</p>`).join("")}<p class="small muted" style="margin-top:8px">Uploading again replaces this table; it never adds a second copy.</p>`);
    else toast(msg);
  }
  function pasteDialog(kind) {
    const t = TEMPLATES[kind];
    modal(`Paste ${kind} CSV`, `<p class="small muted" style="margin-bottom:8px">${esc(t.hint)} Header row: <span class="mono">${esc(t.cols)}</span></p><textarea id="paste-area">${esc(t.cols + "\n" + t.ex)}</textarea><p class="small" id="paste-err" style="color:var(--bad);margin-top:6px"></p>`,
      [{ label: "Load data", primary: true, keep: true, run: () => { try { ingest(kind, $("#paste-area").value); closeModal(); } catch (e) { $("#paste-err").textContent = e.message; } } }]);
  }

  function templateIdeas() {
    const T = { question: "Still dealing with [pain point]? [Product] fixes it.", urgency: "[Offer] ends [date]. Lock in [product] now.", social_proof: "[N] customers switched to [product]. See why.", benefit: "[Verified benefit] in [timeframe]. Meet [product].", ugc: "Real customer: “[quote from a verified review]”", offer: "[Offer] on [product], this week only.", problem_solution: "[Problem]? Here's how [product] solves it in [steps]." };
    const p = st.ideaForm.product || "[product]";
    const top = (k, d) => (R.effects[k][0] && R.effects[k][0].value !== "untagged" && R.effects[k][0].value !== "unknown" ? R.effects[k][0].value : d);
    const combos = R.combos.length ? R.combos : [{ hook: top("hook", "benefit"), cta: top("cta", "Shop now"), format: top("format", "video") }];
    st.ideas = combos.slice(0, 6).map((c) => ({ ...c, platform: st.ideaForm.platform, headline: (T[c.hook] || T.benefit).replace(/\[product\]|\[Product\]/g, p), primary_text: `For ${st.ideaForm.audience.toLowerCase()}. [One sentence on the outcome, backed by proof you can show.]`, rationale: `Untested mix of strong performers: ${nice(c.hook)} hook, “${c.cta}”, ${nice(c.format)}.` }));
    st.ideaSource = "template"; save(); renderResults();
  }
  async function generateIdeas() {
    const key = getKey(); if (!key || generating) return;
    const f = st.ideaForm, seg = R.aud.segments.find((s) => s.name === f.audience);
    const eff = Object.fromEntries(Object.entries(R.effects).map(([k, v]) => [k, v.map((e) => ({ value: e.value, cvr_pct: +(e.rate * 100).toFixed(2), lift_pct: +(e.lift * 100).toFixed(0) }))]));
    const prompt = `You are a performance-marketing copywriter. Write 6 ad variants.

Product/offer: ${f.product || "(not given; write generic copy with [product] placeholders)"}
Platform: ${f.platform}
Audience: ${f.audience}${seg ? ` (targeting play: ${seg.play})` : ""}
Tone: ${f.tone}
Facts you may use (use ONLY these as claims): ${f.notes || "(none given; use [placeholders] for any number, rating, testimonial or guarantee)"}
What our A/B tests show (conversion rate by attribute): ${JSON.stringify(eff)}
Untested combinations we want copy for, in priority order: ${JSON.stringify(R.combos.map(({ hook, cta, format }) => ({ hook, cta, format })))}

Rules: never invent statistics, reviews, testimonials, prices or guarantees. Respect ${f.platform} length norms (headline <= 40 chars; primary text <= 125 chars). Cover the untested combinations first.
Return ONLY a JSON array of 6 objects with keys: hook (one of ${HOOKS.join(", ")}), cta, format (one of ${FORMATS.join(", ")}), headline, primary_text, rationale (one sentence on why it should work).`;
    generating = true; renderResults();
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }) });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((body.error && body.error.message) || `Claude API error ${resp.status}`);
      const res = { text: (body.content || []).map((b) => b.text || "").join("") };
      const m = (res.text || "").match(/\[[\s\S]*\]/); if (!m) throw new Error("Claude's reply had no ad list in it. Try again.");
      const arr = JSON.parse(m[0]);
      st.ideas = arr.slice(0, 6).map((d) => ({ hook: d.hook, cta: d.cta, format: d.format, headline: String(d.headline || ""), primary_text: String(d.primary_text || ""), rationale: d.rationale ? String(d.rationale) : "", platform: f.platform }));
      st.ideaSource = "claude"; logIt(`Claude wrote ${st.ideas.length} ad variants for ${f.platform}`);
    } catch (e) {
      toast(e && e.message ? e.message.slice(0, 120) : "Couldn't write ideas. Try again.");
    } finally { generating = false; save(); if (view === "creative") renderResults(); }
  }


  function fullReport() {
    return JSON.stringify({
      client: clientName(), generated_at: new Date().toISOString(), currency: st.currency, data_source: st.source, settings: st.s,
      performance_since: st.s.since || "campaign start", performance: st.channels.map((c) => ({ channel: c.label, start: c.start, ...R.perf[c.id], creative_fatigue: R.fatByCh[c.id].index })),
      last_reallocation: st.alloc && { at: st.alloc.at, out_of_date: R.allocStale },
      budget: { daily_budget: R.budget.budget, modelled_revenue_now: R.budget.revNow, modelled_revenue_recommended: R.budget.revNew, uplift: R.budget.uplift,
        channels: R.budget.rows.map((r) => ({ channel: r.label, current: +r.current.toFixed(2), recommended: +r.recommended.toFixed(2), roas_now: +r.roasNow.toFixed(3), marginal_roas: +r.marginal.toFixed(3), fit_r2: +r.fit.r2.toFixed(3), status: r.enabled ? "active" : "paused", reason: r.reason })) },
      keywords: { wasted_spend: R.kw.wasted, themes: R.kw.themes, actions: R.kw.rows.filter((r) => r.action !== "keep").map((r) => ({ keyword: r.text, intent: r.intent, action: r.action, cpa: r.cpa, why: r.why })) },
      audiences: R.aud.segments.map((s) => ({ name: s.name, share: s.share, size: s.size, profile: s.profile, play: s.play })),
      creative: { attribute_effects: R.effects, fatigue: R.fat.map((f) => ({ name: f.name, ctr_drop: f.drop, fatigued: f.fatigued })), next_tests: R.combos, ideas: st.ideas },
      alerts: R.findings,
    }, null, 2);
  }

  const clientOrigin = () => (st.clients.find((c) => c.id === st.clientId) || {}).origin;
  const clientName = () => (st.clients.find((c) => c.id === st.clientId) || { name: "Client" }).name;
  const sampleIds = () => st.channels.map((c) => c.id).filter((id) => E.CHANNELS.some((x) => x.id === id));
  function switchClient(id) {
    const c = st.clients.find((x) => x.id === id); if (!c || id === st.clientId || !st.workspaces[id]) return;
    stash(); activateInto(st, id); audVersion++; audCache = { key: null, res: null };
    R = compute(); renderView(); renderNav(); renderStrip(); renderClientPicker(); save();
  }
  function renderClientPicker() {
    const c = st.clients.find((x) => x.id === st.clientId) || {};
    const groups = [["manual", "Your clients"], ["sample", "Demo clients (fictional)"]];
    const tag = c.origin === "sample" ? chip("Demo data", "warn") : chip("Your uploaded data", "good");
    $("#client-pick").innerHTML = `<label for="client-select" class="small muted" style="font-weight:600">Client</label>
      <select id="client-select" aria-label="Client to analyse">${groups.map(([o, t]) => { const list = st.clients.filter((x) => x.origin === o); return list.length ? `<optgroup label="${t}">${list.map((x) => `<option value="${esc(x.id)}" ${x.id === st.clientId ? "selected" : ""}>${esc(x.name)}${x.vertical ? ` · ${esc(x.vertical)}` : ""}</option>`).join("")}</optgroup>` : ""; }).join("")}</select>
      <button class="btn sm" type="button" data-action="new-client">Add client</button>${tag}`;
  }
  const normClient = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const FILE_KINDS = [["channels", "Channel performance (required)", true], ["keywords", "Search terms", false], ["creatives", "Creative daily CTR", false], ["audience", "Customer list", false]];
  function newClientDialog(first) {
    modal(first ? "Upload your data" : "Add a client", `<div class="controls" style="flex-direction:column;align-items:stretch">
      <div class="field"><label for="nc-name">Client name</label><input type="text" id="nc-name" placeholder="e.g. Knot7 Perfumes"></div>
      <div class="field"><label for="nc-vert">Business type (optional)</label><input type="text" id="nc-vert" placeholder="e.g. D2C fragrance"></div>
      ${FILE_KINDS.map(([k, t, req]) => `<div class="field"><label for="nc-${k}">${t}</label><input type="file" id="nc-${k}" accept=".csv,.tsv,.txt,text/csv"><span class="small muted mono">${esc(TEMPLATES[k].cols)}</span></div>`).join("")}
      <p class="small muted">Only channel performance is required. A tab without its file shows an empty state, never made-up numbers. Duplicate rows are removed on load. Files are read in your browser and never uploaded anywhere. Example files are in the <span class="mono">sample-data</span> folder of the project.</p>
      <p class="small" id="nc-err" style="color:var(--bad)"></p></div>`,
      [{ label: "Create client", primary: true, keep: true, run: async () => {
        const err = (m) => ($("#nc-err").textContent = m), name = $("#nc-name").value.trim();
        if (!name) return err("Enter a client name.");
        if (st.clients.some((c) => normClient(c.name) === normClient(name))) return err(`A client called "${st.clients.find((c) => normClient(c.name) === normClient(name)).name}" already exists. Pick it from the menu and upload new files in its tabs to update it.`);
        const files = Object.fromEntries(FILE_KINDS.map(([k]) => [k, $(`#nc-${k}`).files[0] || null]));
        if (!files.channels) return err("Choose the channel performance file.");
        err("Reading files…");
        try {
          const seed = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
          const ws = { seed, source: { channels: "upload", keywords: "none", audience: "none", creatives: "none" }, channels: [], keywords: [], audience: [], variants: [], creatives: [], alloc: null, selCh: null, kwTheme: null, ideas: [], ideaSource: null, creativeCh: "all", total: null, since: null, targetCpa: 40 };
          const notes = []; const parsed = {};
          for (const [k, , ] of FILE_KINDS) { if (!files[k]) continue; try { parsed[k] = PARSERS[k](await files[k].text(), { channels: parsed.channels ? parsed.channels.data : [] }); } catch (e) { throw new Error(`${files[k].name}: ${e.message}`); } }
          Object.entries(parsed).forEach(([k, p]) => { applyParsed(ws, k, p, false); notes.push(`${k}: ${summaryText(k, p)}`, ...p.warnings); });
          if (parsed.keywords) { const c = ws.keywords.reduce((a, k) => a + k.cost, 0), v = ws.keywords.reduce((a, k) => a + k.conversions, 0); if (v) ws.targetCpa = Math.round(c / v); }
          if (first && st.mode !== "upload") { st.clients = st.clients.filter((c) => c.origin !== "sample"); st.workspaces = {}; st.mode = "upload"; }
          const id = `c-${Date.now().toString(36)}`;
          if (st.workspaces[st.clientId]) stash();
          st.clients.push({ id, name, vertical: $("#nc-vert").value.trim(), origin: "manual" }); st.workspaces[id] = ws;
          activateInto(st, id); audVersion++; audCache = { key: null, res: null }; if (!st.mode) st.mode = "upload";
          logIt(`Added client ${name}`); closeModal(); hideStart(); R = compute(); renderView(); renderNav(); renderStrip(); renderClientPicker(); save();
          modal("Client created", notes.map((n) => `<p class="small" style="margin-bottom:6px">${esc(n)}</p>`).join(""));
        } catch (e) { err(e.message); }
      } }]);
  }

  // ---------------- start screen ----------------
  const hideStart = () => $("#start").classList.remove("open");
  function showStart() {
    $("#start").innerHTML = `<div class="start-card"><div class="brand-mark" aria-hidden="true">TD</div>
      <h1>Trilliant Digital Marketing OS</h1>
      <p class="muted">Budget allocation, keyword actions, audience segments and creative fatigue for each client. Everything runs in your browser; your files are never uploaded.</p>
      <div class="start-opts">
        <button class="card start-opt" type="button" data-action="start-demo"><strong>Start with demo data</strong><span class="small muted">Three fictional clients with full data, so you can try every tab.</span></button>
        <button class="card start-opt" type="button" data-action="start-upload"><strong>Upload my data</strong><span class="small muted">CSV exports from Google Ads, Meta or your own sheets. Duplicates are removed automatically.</span></button>
      </div></div>`;
    $("#start").classList.add("open");
  }

  const CURRENCY = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
  const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

  const handlers = {
    menu: () => $("#rail").classList.toggle("open"),
    regen: () => { if (clientOrigin() !== "sample") return toast("New sample data only applies to demo clients."); const seed = Math.floor(Math.random() * 1e6); st.workspaces[st.clientId] = makeWorkspace(seed, sampleIds()); activateInto(st, st.clientId); audVersion++; logIt(`New sample data for ${clientName()}`); R = compute(); renderView(); renderNav(); renderStrip(); save(); toast("New sample data"); },
    "start-demo": () => {
      // idempotent: demo clients are added only if missing, never twice
      SAMPLE_CLIENTS.forEach((c) => { if (!st.clients.some((x) => x.id === c.id)) { st.clients.push({ id: c.id, name: c.name, vertical: c.vertical, origin: "sample" }); st.workspaces[c.id] = makeWorkspace(c.seed, c.channels); } });
      st.mode = "demo"; if (st.workspaces[st.clientId]) stash(); activateInto(st, SAMPLE_CLIENTS[0].id); audVersion++; audCache = { key: null, res: null };
      hideStart(); R = compute(); renderView(); renderNav(); renderStrip(); renderClientPicker(); save();
    },
    "start-upload": () => newClientDialog(true),
    "new-client": () => newClientDialog(false),
    "clear-demo": () => {
      if (!st.clients.some((c) => c.origin === "manual")) return toast("Add one of your own clients first.");
      modal("Remove demo clients?", "<p>The three fictional demo clients will be removed. Your own clients are not touched.</p>", [{ label: "Remove demo clients", primary: true, run: () => {
        const cur = st.clients.find((c) => c.origin === "manual"); stash();
        st.clients = st.clients.filter((c) => c.origin !== "sample"); Object.keys(st.workspaces).forEach((id) => { if (!st.clients.some((c) => c.id === id)) delete st.workspaces[id]; });
        if (!st.workspaces[st.clientId]) activateInto(st, cur.id); audVersion++; audCache = { key: null, res: null }; R = compute(); renderView(); renderNav(); renderStrip(); renderClientPicker(); save(); } }]);
    },
    "reset-all": () => modal("Reset all data?", "<p>This deletes every client and uploaded file stored in this browser and returns to the start screen. Your original CSV files are not affected.</p>", [{ label: "Delete and start over", primary: true, run: () => {
      try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      st = fresh(); audVersion++; audCache = { key: null, res: null }; R = compute(); renderView(); renderNav(); renderStrip(); renderClientPicker(); showStart(); } }]),
    "api-key": () => keyDialog(),

    "export-report": () => { logIt(`${clientName()}: exported full report`); save(); offerFile(`${clientName().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-report.json`, fullReport()); },
    paste: (el) => pasteDialog(el.dataset.kind),
    "reset-data": (el) => { const k = el.dataset.kind;
      if (clientOrigin() === "sample") { const f = makeWorkspace(st.seed, sampleIds()); st[k] = f[k]; st.source[k] = "sample"; if (k === "channels") { st.s.total = null; st.s.since = null; st.alloc = null; st.selCh = f.selCh; }
        if (k === "creatives") st.creatives = E.sampleCreativeCtr(st.seed, st.channels); if (k === "audience") audVersion++; }
      else { st[k] = []; st.source[k] = "none"; if (k === "keywords") st.kwTheme = null; if (k === "audience") audVersion++; }
      R = compute(); renderView(); renderNav(); renderStrip(); save(); },
    reallocate: () => {
      const P = R.proposal;
      st.alloc = { at: stamp(), total: P.budget, amounts: Object.fromEntries(P.rows.map((r) => [r.id, r.recommended])), reasons: Object.fromEntries(P.rows.map((r) => [r.id, r.reason])),
        notes: P.notes, fatigueWeight: st.s.fatigueWeight, limitShift: st.s.limitShift, maxShift: st.s.maxShift, since: st.s.since };
      logIt(`${clientName()}: re-allocated ${money(P.budget)}/day: ` + P.rows.filter((r) => r.enabled).map((r) => `${r.label} ${money(r.recommended)}`).join(", "));
      recompute(); toast("New amounts recommended");
      const el = document.getElementById("realloc"); if (el) el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    },
    "clear-alloc": () => { st.alloc = null; logIt("Cleared re-allocation; back to current spend"); recompute(); },
    "since-start": () => { st.s.since = null; const el = $("#f-since"); if (el) el.value = ""; recompute(); },
    "budget-reset": () => { st.s.total = null; R = compute(); renderView(); renderStrip(); renderNav(); save(); },
    "sel-ch": (el, e) => { if (e.target.closest("input,label")) return; st.selCh = el.dataset.id; renderResults(); save(); },
    "kw-intent": (el) => { st.kwIntent = el.dataset.v; document.querySelectorAll('[data-action="kw-intent"]').forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === st.kwIntent)); renderResults(); save(); },
    "kw-theme": (el) => { st.kwTheme = el.dataset.v === "" ? null : +el.dataset.v; renderResults(); save(); },
    "kw-sort": (el) => { const k = el.dataset.k; st.kwSort = st.kwSort.key === k ? { key: k, dir: -st.kwSort.dir } : { key: k, dir: typeof R.kw.rows[0][k] === "string" ? 1 : -1 }; renderResults(); save(); },
    "copy-negatives": () => { const n = R.kw.rows.filter((r) => r.action === "negative").map((r) => `[${r.text}]`); if (!n.length) return toast("No negatives suggested"); copyText(n.join("\n"), `Copied ${n.length} negatives as exact match`); },
    "export-kw": () => offerFile("keyword-actions.csv", E.toCSV(R.kw.rows.map((r) => ({ ...r, cpa: r.cpa == null ? "" : r.cpa.toFixed(2), ctr: r.ctr.toFixed(4), cvr: r.cvr.toFixed(4), theme: (R.kw.themes.find((t) => t.id === r.theme) || {}).name })), ["text", "theme", "intent", "impressions", "clicks", "ctr", "conversions", "cvr", "cost", "cpa", "action", "why"])),
    "seg-ideas": (el) => { st.ideaForm.audience = el.dataset.name; save(); location.hash = "creative"; },
                    "gen-ideas": generateIdeas,
    "template-ideas": templateIdeas,
    "clear-ideas": () => { st.ideas = []; st.ideaSource = null; save(); renderResults(); },
    "copy-idea": (el) => { const d = st.ideas[+el.dataset.i]; copyText(`${d.headline}\n${d.primary_text}\nCTA: ${d.cta}`, "Ad copy copied"); },
                "export-budgets": () => { const csv = E.toCSV(R.budget.rows.map((r) => ({ client: clientName(), channel: r.label, new_daily_budget: r.recommended.toFixed(2), current_daily: r.current.toFixed(2), change_pct: (r.delta * 100).toFixed(1), status: r.enabled ? "active" : "paused", why: r.reason })), ["client", "channel", "new_daily_budget", "current_daily", "change_pct", "status", "why"]); logIt(`${clientName()}: exported budgets, ${money(R.budget.budget)}/day`); save(); offerFile(`${clientName().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-budgets.csv`, csv); },
      };

  // ---------------- events ----------------
  function readVal(el) {
    if (el.type === "checkbox") return el.checked;
    const t = el.dataset.type || (el.type === "number" || el.type === "range" ? "num" : "str");
    if (t === "str") return el.value;
    if (el.value === "") return null; const n = parseFloat(el.value); return isNaN(n) ? null : n;
  }
  function applySetting(el) {
    const v = readVal(el);
    if (el.dataset.set) {
      const k = el.dataset.set; st.s[k] = k === "since" && !v ? null : v;
      document.querySelectorAll(`[data-set="${k}"]`).forEach((o) => { if (o !== el && o.type !== "checkbox") o.value = v == null ? "" : v; });
      document.querySelectorAll(`[data-out="${k}"]`).forEach((o) => { const suf = /Shift|Pct|Weight/.test(k) ? "%" : ""; o.textContent = `${v}${suf}`; });
      return true;
    }
    if (el.dataset.state) { st[el.dataset.state] = v == null ? "" : v; return true; }
    if (el.dataset.form) { st.ideaForm[el.dataset.form] = el.value; save(); return false; }
    if (el.dataset.ch) { const c = st.channels.find((x) => x.id === el.dataset.ch); if (c) c[el.dataset.f] = el.dataset.f === "enabled" ? v : v == null ? 0 : v; return true; }
    return false;
  }
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-modal]");
    if (m) { if (m.dataset.modal === "close") return closeModal(); const a = modal.actions[+m.dataset.modal]; if (a) { a.run(); if (!a.keep) closeModal(); } return; }
    if (e.target.id === "modal") return closeModal();
    const a = e.target.closest("[data-action]"); if (!a) return;
    const h = handlers[a.dataset.action]; if (h) h(a, e);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.type === "range" || el.dataset.live) { if (applySetting(el)) scheduleRecompute(); }
    else if (el.dataset.form) applySetting(el);
  });
  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.id === "client-select") { switchClient(el.value); return; }
    if (el.dataset.move) { moveAccount(el.dataset.move, el.value); return; }
    if (el.id === "currency") { st.currency = el.value; R = compute(); renderView(); renderStrip(); renderNav(); save(); return; }
    if (el.dataset.upload) { const file = el.files && el.files[0]; if (!file) return; file.text().then((t) => { try { ingest(el.dataset.upload, t); } catch (err) { modal("Couldn't load that file", `<p>${esc(err.message)}</p><p class="small muted" style="margin-top:8px">Expected header: <span class="mono">${esc(TEMPLATES[el.dataset.upload].cols)}</span></p>`); } }); el.value = ""; return; }
    if (el.type === "range" || el.dataset.live) return;
    if (applySetting(el)) recompute();
  });
  function route() {
    const h = location.hash.replace("#", "");
    view = VIEWS.some((v) => v.id === h) ? h : "overview";
    renderView(); renderNav(); window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  const rerenderCharts = () => { if (R) renderResults(); };
  try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerenderCharts); } catch (e) { /* old browser */ }
  new MutationObserver(rerenderCharts).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  if (window.Chart) { Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; }
  R = compute(); renderClientPicker(); renderStrip(); route(); if (!st.mode) showStart();
})();
