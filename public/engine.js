/* Optimization engine: pure functions, no DOM. Exposed as window.Engine (and module.exports for tests). */
(function (root) {
  "use strict";

  // ---------- math helpers ----------
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    next.normal = (mu = 0, sd = 1) => {
      if (spare !== null) { const s = spare; spare = null; return mu + sd * s; }
      let u, v, s;
      do { u = next() * 2 - 1; v = next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * m; return mu + sd * u * m;
    };
    next.uniform = (lo, hi) => lo + (hi - lo) * next();
    next.int = (lo, hi) => Math.floor(lo + (hi - lo) * next());
    next.gamma = (k) => {
      if (k < 1) return next.gamma(k + 1) * Math.pow(next(), 1 / k);
      const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
      for (;;) {
        let x, v;
        do { x = next.normal(); v = 1 + c * x; } while (v <= 0);
        v = v * v * v; const u = next();
        if (u < 1 - 0.0331 * x ** 4) return d * v;
        if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
      }
    };
    next.beta = (a, b) => { const x = next.gamma(a); return x / (x + next.gamma(b)); };
    next.binomial = (n, p) => { // normal approx for large n
      const mu = n * p, sd = Math.sqrt(n * p * (1 - p));
      return Math.max(0, Math.min(n, Math.round(next.normal(mu, sd))));
    };
    return next;
  }
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  function lgamma(x) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1; let a = c[0]; const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betaPdf(x, a, b) {
    if (x <= 0 || x >= 1) return 0;
    return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lgamma(a) + lgamma(b) - lgamma(a + b)));
  }
  function normInv(p) { // Acklam
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pl = 0.02425; let q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // ---------- sample data ----------
  const CHANNELS = [
    { id: "google_search", label: "Google Search", vmax: 9000, k: 1800, noise: 0.06 },
    { id: "google_pmax", label: "Google PMax", vmax: 6500, k: 1500, noise: 0.10 },
    { id: "meta", label: "Meta (FB + IG)", vmax: 7000, k: 1700, noise: 0.09 },
    { id: "youtube", label: "YouTube", vmax: 2600, k: 1100, noise: 0.15 },
    { id: "tiktok", label: "TikTok", vmax: 3500, k: 900, noise: 0.18 },
    { id: "linkedin", label: "LinkedIn", vmax: 2200, k: 1400, noise: 0.12 },
  ];
  const hill = (s, vmax, k, n = 1) => (s <= 0 ? 0 : vmax * s ** n / (s ** n + k ** n));

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, "0");
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return isoDay(t); };
  const dayDiff = (a, b) => { const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5); };
  const yesterday = () => { const t = new Date(); t.setDate(t.getDate() - 1); return isoDay(t); };

  // days each sample campaign has been live (ends yesterday)
  const LIVE_DAYS = { google_search: 120, google_pmax: 75, meta: 90, youtube: 45, tiktok: 32, linkedin: 60 };
  function sampleChannels(seed = 7, end = yesterday(), only = null) {
    const r = rng(seed);
    return CHANNELS.filter((c) => !only || only.includes(c.id)).map((c) => {
      const days = LIVE_DAYS[c.id] || 45;
      const base = r.uniform(0.6, 1.4) * c.k;
      const spend = [], revenue = [], conversions = [], dates = [];
      for (let d = 0; d < days; d++) {
        const s = Math.max(80, r.normal(base, base * 0.35));
        const rev = hill(s, c.vmax, c.k) * Math.exp(r.normal(0, c.noise));
        dates.push(addDays(end, d - days + 1));
        spend.push(+s.toFixed(2)); revenue.push(+rev.toFixed(2)); conversions.push(+(rev / r.uniform(45, 70)).toFixed(2));
      }
      if (c.id === "tiktok") { spend[days - 1] *= 3.2; revenue[days - 1] *= 0.2; } // injected anomaly
      return { id: c.id, label: c.label, start: dates[0], dates, spend, revenue, conversions, min: 100, max: 6000, enabled: true };
    });
  }

  /** Slice a channel's history to dates >= since (or its own start). */
  function windowed(c, since) {
    const from = since && since > c.start ? since : c.start;
    let i = c.dates ? c.dates.findIndex((d) => d >= from) : 0; if (i < 0) i = c.dates.length;
    return { ...c, from, dates: c.dates ? c.dates.slice(i) : null, spend: c.spend.slice(i), revenue: c.revenue.slice(i), conversions: (c.conversions || []).slice(i) };
  }
  function performance(c, since) {
    const w = windowed(c, since), n = w.spend.length;
    const spend = sum(w.spend), revenue = sum(w.revenue), conv = sum(w.conversions);
    const r7 = n >= 7 ? sum(w.revenue.slice(-7)) / sum(w.spend.slice(-7)) : null;
    const p7 = n >= 14 ? sum(w.revenue.slice(-14, -7)) / sum(w.spend.slice(-14, -7)) : null;
    return { from: w.from, to: w.dates && w.dates.length ? w.dates[n - 1] : null, days: n, spend, revenue, conv,
      roas: spend ? revenue / spend : 0, cpa: conv ? spend / conv : null, avgDaily: n ? spend / n : 0,
      roas7: r7, trend7: r7 != null && p7 ? r7 / p7 - 1 : null };
  }

  const KW_THEMES = {
    "running shoes": ["buy running shoes", "best running shoes", "running shoes for flat feet", "cheap running shoes",
      "running shoes sale", "trail running shoes", "running shoes women", "nike running shoes price"],
    yoga: ["yoga mat buy", "best yoga mat", "yoga mat free", "yoga mat reviews", "eco yoga mat", "yoga mat price"],
    "fitness tracker": ["fitness tracker price", "best fitness tracker", "fitness tracker jobs", "smartwatch fitness tracker",
      "fitness tracker comparison", "fitness tracker how it works"],
    protein: ["whey protein buy", "protein powder vegan", "free protein samples", "protein powder near me",
      "best protein powder", "protein powder side effects", "plant protein discount"],
  };
  function sampleKeywords(seed = 7) {
    const r = rng(seed + 101); const out = [];
    for (const words of Object.values(KW_THEMES)) for (const w of words) {
      const impressions = r.int(2000, 60000), clicks = Math.round(impressions * r.uniform(0.005, 0.07));
      let cvr = r.uniform(0.004, 0.08); if (/free|jobs|cheap|side effects|how it works/.test(w)) cvr *= 0.12;
      const conversions = +(clicks * cvr).toFixed(1), cost = +(clicks * r.uniform(0.4, 2.8)).toFixed(2);
      out.push({ text: w, impressions, clicks, conversions, cost, revenue: +(conversions * r.uniform(40, 90)).toFixed(2) });
    }
    return out;
  }

  const AUD_FEATURES = ["recency_days", "frequency", "monetary", "age", "sessions_per_wk"];
  const AUD_LABELS = { recency_days: "Days since last visit", frequency: "Orders (90d)", monetary: "Spend (90d)", age: "Age", sessions_per_wk: "Sessions / week" };
  function sampleAudience(seed = 7, n = 600) {
    const r = rng(seed + 202);
    const groups = [[0.27, [5, 8, 220, 29, 6]], [0.33, [60, 1, 35, 24, 2]], [0.23, [12, 3, 90, 38, 4]], [0.17, [3, 0.5, 15, 21, 9]]];
    const rows = [];
    for (const [share, mu] of groups) for (let i = 0; i < Math.round(n * share); i++)
      rows.push(mu.map((m) => Math.max(0, r.normal(m, m * 0.25 + 0.1))));
    return rows;
  }

  function sampleVariants(seed = 7) {
    const r = rng(seed + 303);
    const spec = [["A · Control", "question", "Shop now", "static", 0.021, 30000], ["B · Urgency", "urgency", "Shop now", "static", 0.026, 29000],
      ["C · Social proof", "social_proof", "Get yours", "video", 0.029, 31000], ["D · Benefit", "benefit", "Get yours", "video", 0.024, 12000],
      ["E · UGC", "social_proof", "Shop now", "video", 0.0285, 9000]];
    return spec.map(([name, hook, cta, format, p, n]) => ({ name, impressions: n, conversions: r.binomial(n, p), hook, cta, format }));
  }

  // creatives per channel: [name, base CTR, decay over the window]
  const CREATIVE_SPECS = {
    google_search: [["RSA · Brand terms", 0.081, 0.02], ["RSA · Generic", 0.046, -0.08]],
    google_pmax: [["Asset group · Bestsellers", 0.022, -0.12], ["Asset group · New arrivals", 0.019, -0.03]],
    meta: [["Summer sale carousel", 0.034, -0.45], ["UGC unboxing reel", 0.031, -0.30]],
    youtube: [["Founder story video", 0.012, -0.05], ["6s bumper · offer", 0.009, -0.10]],
    tiktok: [["Creator hook #1", 0.028, -0.38], ["Spark ad · review", 0.024, -0.12]],
    linkedin: [["Static product shot", 0.0068, 0.02], ["Document ad · guide", 0.0074, -0.06]],
  };
  function sampleCreativeCtr(seed = 7, channels = null, days = 28) {
    const r = rng(seed + 404); const out = [];
    const chans = channels || CHANNELS.map((c) => ({ id: c.id, label: c.label, dates: null }));
    chans.forEach((c) => {
      (CREATIVE_SPECS[c.id] || [[`${c.label} creative`, 0.02, -0.05]]).forEach(([name, base, decay]) => {
        const n = Math.min(days, c.dates ? c.dates.length : days);
        const dates = c.dates ? c.dates.slice(-n) : null;
        out.push({ name, channel: c.id, dates, ctr: Array.from({ length: n }, (_, d) => Math.max(0.0005, base * (1 + decay * d / n) * Math.exp(r.normal(0, 0.06)))) });
      });
    });
    return out;
  }
  /** Channel-level fatigue: average CTR decline across its creatives (0 = none, 1 = CTR gone). */
  function channelFatigue(fatRows, channelId) {
    const mine = fatRows.filter((f) => f.channel === channelId && f.ctr.length >= 8);
    if (!mine.length) return { index: 0, worst: null, fatigued: 0, count: 0 };
    const worst = mine.reduce((a, b) => (b.drop > a.drop ? b : a));
    const index = Math.min(1, mean(mine.map((f) => Math.max(0, f.drop))));
    return { index, worst: worst.drop > 0 ? worst : null, fatigued: mine.filter((f) => f.fatigued).length, count: mine.length };
  }

  // ---------- 1. Budget ----------
  function fitCurve(spend, revenue) {
    const smin = Math.min(...spend), smax = Math.max(...spend), ks = [];
    const lo = Math.max(smin * 0.3, 10), hi = smax * 4;
    for (let i = 0; i < 60; i++) ks.push(lo * (hi / lo) ** (i / 59));
    let best = null;
    for (const n of [0.7, 0.85, 1, 1.2, 1.5]) for (const k of ks) {
      let ff = 0, fy = 0; const f = spend.map((s) => s ** n / (s ** n + k ** n));
      for (let i = 0; i < f.length; i++) { ff += f[i] * f[i]; fy += f[i] * revenue[i]; }
      if (!ff) continue; const vmax = fy / ff; if (vmax <= 0) continue;
      let sse = 0; for (let i = 0; i < f.length; i++) sse += (revenue[i] - vmax * f[i]) ** 2;
      if (!best || sse < best.sse) best = { sse, vmax, k, n };
    }
    const m = mean(revenue); const sst = sum(revenue.map((y) => (y - m) ** 2)) || 1;
    const fit = { vmax: best.vmax, k: best.k, n: best.n, r2: Math.max(0, 1 - best.sse / sst), range: smax / Math.max(smin, 1e-9) };
    fit.confident = fit.r2 >= 0.35 && fit.range >= 1.5;
    return fit;
  }
  const curveRev = (f, s) => hill(s, f.vmax, f.k, f.n);
  const curveMarginal = (f, s) => { const e = Math.max(1, s * 0.01); return (curveRev(f, s + e) - curveRev(f, Math.max(0, s - e))) / (s - e < 0 ? s + e : 2 * e); };

  /**
   * Allocate a daily budget across channels.
   * Value of the next dollar in a channel = curve marginal ROAS x (1 - fatigueWeight x fatigue index).
   * Hard bounds: each channel's min/max. Optional: limit the day-over-day change (limitShift).
   * Optional floor: no dollar above a channel's min goes where fatigue-adjusted marginal ROAS < targetRoas.
   */
  function optimizeBudget(channels, opts) {
    const { total, maxShift = 0.3, lowConfShift = 0.1, lookback = 14, targetRoas = null, excludeLastDay = new Set(),
      limitShift = true, fatigue = {}, fatigueWeight = 0.5 } = opts;
    const rows = channels.map((c) => {
      const drop = excludeLastDay.has(c.id) ? 1 : 0;
      const spend = c.spend.slice(0, c.spend.length - drop), revenue = c.revenue.slice(0, c.revenue.length - drop);
      // fit only on days with spend (paused days carry no information about the curve)
      const live = spend.map((v, i) => [v, revenue[i]]).filter(([v]) => v > 0);
      const fit = fitCurve(live.length >= 3 ? live.map((x) => x[0]) : [1, 2, 3], live.length >= 3 ? live.map((x) => x[1]) : [0, 0, 0]);
      const current = mean(spend.slice(-lookback));
      const fat = Math.max(0, Math.min(1, fatigue[c.id] || 0));
      const penalty = 1 - fatigueWeight * fat;
      const shift = fit.confident ? maxShift : lowConfShift;
      // your min/max are hard limits; the change limit only applies inside them
      const cmin = Math.max(0, c.min || 0), cmax = Math.max(cmin, c.max == null ? Infinity : c.max);
      let lo = c.enabled ? cmin : 0, hi = c.enabled ? cmax : 0;
      if (limitShift && c.enabled) { lo = Math.min(Math.max(lo, current * (1 - shift)), cmax); hi = Math.max(Math.min(hi, current * (1 + shift)), lo); }
      return { id: c.id, label: c.label, fit, current, lo, hi, cmin, cmax, enabled: c.enabled, spend, revenue, fatigue: fat, penalty };
    });
    const eff = (r, s) => curveMarginal(r.fit, s) * r.penalty;
    const budget = total != null ? total : sum(rows.map((r) => (r.enabled ? r.current : 0)));
    const alloc = rows.map((r) => r.lo);
    let remaining = budget - sum(alloc);
    const notes = [];
    if (remaining < 0) { const s = budget / sum(alloc); for (let i = 0; i < alloc.length; i++) alloc[i] *= s; remaining = 0; notes.push("Channel minimums add up to more than the budget, so every channel was scaled down proportionally."); }
    const step = Math.max(1, budget / 1500);
    let heldForTarget = false;
    while (remaining > 1e-6) {
      const inc = Math.min(step, remaining); let bi = -1, bm = -Infinity;
      rows.forEach((r, i) => {
        if (!r.enabled || alloc[i] + inc > r.hi + 1e-9) return;
        const m = eff(r, alloc[i] + inc / 2);
        if (targetRoas && m < targetRoas) { heldForTarget = true; return; }
        if (m > bm) { bm = m; bi = i; }
      });
      if (bi < 0) break; alloc[bi] += inc; remaining -= inc;
    }
    if (remaining > 1) notes.push(heldForTarget
      ? `${remaining.toFixed(0)}/day is held back: no channel clears your target ROAS after fatigue adjustment.`
      : `Channel maximums${limitShift ? " and the daily change limit" : ""} leave ${remaining.toFixed(0)}/day undeployed.`);
    const out = rows.map((r, i) => {
      const rec = alloc[i], m = curveMarginal(r.fit, rec), e = eff(r, rec), roasNow = r.current ? curveRev(r.fit, r.current) / r.current : 0;
      const delta = r.current ? (rec - r.current) / r.current : 0;
      const atMax = r.enabled && rec >= r.hi - Math.max(1, step), atMin = r.enabled && rec <= r.lo + 1e-6;
      const boundBy = !r.enabled ? null : atMin && r.lo <= r.cmin + 1 ? "min" : atMax && r.hi >= r.cmax - 1 ? "max" : atMin || atMax ? "shift" : null;
      const flags = [];
      if (!r.fit.confident && r.enabled) flags.push("low_confidence");
      if (targetRoas && e < targetRoas && r.enabled) flags.push("below_target");
      if (r.fatigue >= 0.1 && r.enabled) flags.push("fatigued");
      return { ...r, recommended: rec, delta, marginal: m, effMarginal: e, roasNow, flags, boundBy, reasonParts: reasonParts(r, rec, delta, m, e, boundBy) };
    });
    const revNow = sum(out.map((r) => (r.enabled ? curveRev(r.fit, r.current) : 0)));
    const spendNow = sum(out.map((r) => (r.enabled ? r.current : 0)));
    const revNew = sum(out.map((r) => curveRev(r.fit, r.recommended)));
    out.forEach((r) => (r.reason = r.reasonParts.join(" ")));
    const free = out.filter((r) => r.enabled && !r.boundBy);
    const edge = free.length ? Math.max(...free.map((r) => r.effMarginal)) : null;
    if (edge != null && edge < 1 && !targetRoas) notes.push(`At this budget the last dollar in every channel returns about ${edge.toFixed(2)}x, less than it costs. Consider a lower total or set a target ROAS of 1.0 so unprofitable spend is held back.`);
    return { rows: out, budget, revNow, revNew, spendNow, uplift: revNow ? revNew / revNow - 1 : 0, notes, opts: { limitShift, fatigueWeight, targetRoas } };
  }
  function reasonParts(r, rec, delta, m, e, boundBy) {
    if (!r.enabled) return ["Paused by you."];
    const p = [], eCur = curveMarginal(r.fit, Math.max(r.current, 1)) * r.penalty;
    if (Math.abs(delta) < 0.02) p.push(`Hold: next dollar returns ${e.toFixed(2)}x, in line with other channels.`);
    else if (delta > 0) p.push(`Next dollar returns ${eCur.toFixed(2)}x today, the best available. Add until it falls to ${e.toFixed(2)}x.`);
    else p.push(`Next dollar returns only ${eCur.toFixed(2)}x today. It earns more elsewhere.`);
    if (r.fatigue >= 0.05) p.push(`Creative CTR −${(r.fatigue * 100).toFixed(0)}% cuts its value ${((1 - r.penalty) * 100).toFixed(0)}%.`);
    if (boundBy === "max") p.push("Capped at your max.");
    if (boundBy === "min") p.push("Held at your min.");
    if (boundBy === "shift") p.push("Held by the change limit.");
    return p;
  }

  // ---------- 2. Segmentation ----------
  const STOP = new Set(["a", "the", "for", "to", "of", "in", "and", "near", "me", "it", "how"]);
  const NEG = new Set(["free", "jobs", "job", "career", "diy", "pdf", "salary", "wiki", "cheap", "samples", "torrent", "side", "effects"]);
  const TRANS = new Set(["buy", "price", "sale", "order", "deal", "discount", "shop", "purchase"]);
  const COMM = new Set(["best", "reviews", "review", "comparison", "vs", "top", "compare"]);
  const tokens = (t) => (t.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w));
  function intent(text) {
    const t = tokens(text);
    if (t.some((w) => NEG.has(w))) return "low_intent";
    if (t.some((w) => TRANS.has(w))) return "transactional";
    if (t.some((w) => COMM.has(w))) return "commercial";
    return "informational";
  }
  const dist2 = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s; };
  function kmeans(x, k, seed = 0, iters = 100, nInit = 6) {
    const r = rng(seed + 999); let best = null;
    for (let t = 0; t < nInit; t++) {
      const c = [x[r.int(0, x.length)].slice()];
      while (c.length < k) {
        const d = x.map((p) => Math.min(...c.map((q) => dist2(p, q)))); const tot = sum(d);
        let u = r() * tot, j = 0; while (j < d.length - 1 && (u -= d[j]) > 0) j++;
        c.push(x[j].slice());
      }
      let lab = new Array(x.length).fill(0);
      for (let it = 0; it < iters; it++) {
        lab = x.map((p) => { let bi = 0, bd = Infinity; c.forEach((q, i) => { const d = dist2(p, q); if (d < bd) { bd = d; bi = i; } }); return bi; });
        let moved = false;
        for (let j = 0; j < k; j++) {
          const mem = x.filter((_, i) => lab[i] === j); if (!mem.length) continue;
          const nc = mem[0].map((_, d) => mean(mem.map((p) => p[d])));
          if (dist2(nc, c[j]) > 1e-12) moved = true; c[j] = nc;
        }
        if (!moved) break;
      }
      const inertia = sum(x.map((p, i) => dist2(p, c[lab[i]])));
      if (!best || inertia < best.inertia) best = { inertia, lab, c };
    }
    return best;
  }
  function silhouette(x, lab) {
    const ks = [...new Set(lab)]; if (ks.length < 2) return 0; let tot = 0;
    for (let i = 0; i < x.length; i++) {
      const acc = {}; const cnt = {};
      for (let j = 0; j < x.length; j++) { if (i === j) continue; const d = Math.sqrt(dist2(x[i], x[j])); acc[lab[j]] = (acc[lab[j]] || 0) + d; cnt[lab[j]] = (cnt[lab[j]] || 0) + 1; }
      if (!cnt[lab[i]]) continue;
      const a = acc[lab[i]] / cnt[lab[i]]; let b = Infinity;
      for (const k of ks) if (k !== lab[i] && cnt[k]) b = Math.min(b, acc[k] / cnt[k]);
      tot += (b - a) / Math.max(a, b);
    }
    return tot / x.length;
  }

  function analyzeKeywords(kws, { targetCpa = 40, minClicks = 100, nThemes = 4 } = {}) {
    const docs = kws.map((k) => tokens(k.text)); const df = {};
    docs.forEach((d) => new Set(d).forEach((w) => (df[w] = (df[w] || 0) + 1)));
    const vocab = Object.keys(df).sort(); const idx = Object.fromEntries(vocab.map((w, i) => [w, i]));
    const m = docs.map((d) => {
      const v = new Array(vocab.length).fill(0); const tf = {}; d.forEach((w) => (tf[w] = (tf[w] || 0) + 1));
      for (const [w, c] of Object.entries(tf)) v[idx[w]] = (1 + Math.log(c)) * Math.log((1 + docs.length) / (1 + df[w]) + 1);
      const n = Math.sqrt(sum(v.map((x) => x * x))) || 1; return v.map((x) => x / n);
    });
    const k = Math.max(1, Math.min(nThemes, kws.length));
    const km = kmeans(m, k, 3);
    const themes = [];
    for (let j = 0; j < k; j++) {
      const mem = kws.filter((_, i) => km.lab[i] === j); if (!mem.length) continue;
      const top = km.c[j].map((v, i) => [v, vocab[i]]).sort((a, b) => b[0] - a[0]).slice(0, 2).map((t) => t[1]);
      const cost = sum(mem.map((x) => x.cost)), conv = sum(mem.map((x) => x.conversions)), rev = sum(mem.map((x) => x.revenue || 0));
      themes.push({ id: j, name: top.join(" · "), count: mem.length, cost, conv, rev, cpa: conv ? cost / conv : null, roas: cost ? rev / cost : 0 });
    }
    const rows = kws.map((kw, i) => {
      const it = intent(kw.text), cpa = kw.conversions ? kw.cost / kw.conversions : null;
      const ctr = kw.impressions ? kw.clicks / kw.impressions : 0, cvr = kw.clicks ? kw.conversions / kw.clicks : 0;
      let action = "keep", why = "Within target range.";
      if (kw.clicks < minClicks) { action = "watch"; why = `Fewer than ${minClicks} clicks; not enough data.`; }
      else if ((it === "low_intent" && (cpa == null || cpa > targetCpa)) || (kw.conversions < 1 && kw.cost > targetCpa * 1.5)) { action = "negative"; why = it === "low_intent" ? "Low-intent query above target CPA." : "Spend with no conversions."; }
      else if (cpa != null && cpa < targetCpa * 0.7 && kw.conversions >= 5) { action = "raise_bid"; why = `CPA ${cpa.toFixed(0)} is well under target; capture more volume.`; }
      else if (cpa != null && cpa > targetCpa * 1.4) { action = "lower_bid"; why = `CPA ${cpa.toFixed(0)} is over target.`; }
      return { ...kw, intent: it, cpa, ctr, cvr, theme: km.lab[i], action, why };
    });
    return { rows, themes, wasted: sum(rows.filter((r) => r.action === "negative").map((r) => r.cost)) };
  }

  function segmentLabel(p) {
    if (p.monetary > 150 && p.recency_days < 20) return ["Champions", "Seed lookalikes from this list. Leave them out of discount offers; push upsell and loyalty."];
    if (p.recency_days > 40 && p.frequency < 2) return ["Lapsed / at-risk", "Run win-back creative with a time-limited offer. Cap frequency and keep bids low."];
    if (p.sessions_per_wk > 7 && p.monetary < 30) return ["Engaged, not converted", "Make them a retargeting priority. Use a first-purchase incentive and social-proof creative."];
    if (p.monetary > 60) return ["Core regulars", "Send cross-sell and replenishment reminders. Keep bids steady."];
    return ["Occasional buyers", "Use broad prospecting creative and frequency caps. Test value bundles."];
  }
  function segmentAudience(rows, { k = null, seed = 1 } = {}) {
    const mu = AUD_FEATURES.map((_, d) => mean(rows.map((r) => r[d])));
    const sd = AUD_FEATURES.map((_, d) => std(rows.map((r) => r[d])) || 1);
    const z = rows.map((r) => r.map((v, d) => (v - mu[d]) / sd[d]));
    const candidates = k ? [k] : [3, 4, 5, 6]; let best = null; const scores = {};
    const sampleIdx = z.length > 400 ? z.map((_, i) => i).filter((i) => i % Math.ceil(z.length / 400) === 0) : z.map((_, i) => i);
    for (const kk of candidates) {
      const km = kmeans(z, kk, seed);
      const s = silhouette(sampleIdx.map((i) => z[i]), sampleIdx.map((i) => km.lab[i])); scores[kk] = s;
      if (!best || s > best.s) best = { s, k: kk, lab: km.lab };
    }
    const segs = [];
    for (let j = 0; j < best.k; j++) {
      const mem = rows.filter((_, i) => best.lab[i] === j); if (!mem.length) continue;
      const prof = Object.fromEntries(AUD_FEATURES.map((f, d) => [f, mean(mem.map((r) => r[d]))]));
      const [name, play] = segmentLabel(prof);
      segs.push({ id: j, name, play, size: mem.length, share: mem.length / rows.length, profile: prof });
    }
    segs.sort((a, b) => b.profile.monetary - a.profile.monetary);
    return { k: best.k, silhouette: best.s, scores, labels: best.lab, segments: segs };
  }

  // ---------- 3. A/B ----------
  function analyzeAB(variants, { controlIndex = 0, draws = 20000, winProb = 0.95, maxLoss = 0.0005, minImp = 5000, seed = 11 } = {}) {
    const r = rng(seed), V = variants.length;
    const wins = new Array(V).fill(0), loss = new Array(V).fill(0), beats = new Array(V).fill(0), lifts = variants.map(() => []);
    const samples = variants.map(() => []);
    for (let t = 0; t < draws; t++) {
      const th = variants.map((v) => r.beta(1 + v.conversions, 1 + Math.max(0, v.impressions - v.conversions)));
      let mx = -1, mi = 0; th.forEach((x, i) => { if (x > mx) { mx = x; mi = i; } });
      wins[mi]++;
      th.forEach((x, i) => { loss[i] += mx - x; if (x > th[controlIndex]) beats[i]++; if (t % 4 === 0) { lifts[i].push(x / th[controlIndex] - 1); samples[i].push(x); } });
    }
    const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    const rows = variants.map((v, i) => ({
      ...v, rate: v.impressions ? v.conversions / v.impressions : 0,
      pBest: wins[i] / draws, expLoss: loss[i] / draws, pBeatsControl: i === controlIndex ? null : beats[i] / draws,
      lift: i === controlIndex ? 0 : median(lifts[i]), liftCI: i === controlIndex ? [0, 0] : [pct(lifts[i], 0.025), pct(lifts[i], 0.975)],
      ci: [pct(samples[i], 0.025), pct(samples[i], 0.975)],
    }));
    let w = 0; rows.forEach((x, i) => { if (x.pBest > rows[w].pBest) w = i; });
    const enough = variants.every((v) => v.impressions >= minImp);
    const decided = enough && rows[w].pBest >= winProb && rows[w].expLoss <= maxLoss;
    const raw = rows.map((x) => Math.max(x.pBest, 0.05)); const tot = sum(raw);
    rows.forEach((x, i) => { x.nextShare = raw[i] / tot; x.pause = i !== controlIndex && x.impressions >= minImp && x.pBest < 0.02 && x.expLoss > 3 * maxLoss; });
    return { rows, leader: w, decided, enough };
  }
  function sampleSize(base, mdeRel, alpha = 0.05, power = 0.8) {
    const p1 = base, p2 = base * (1 + mdeRel); if (p2 >= 1 || p1 <= 0 || mdeRel === 0) return Infinity;
    const za = normInv(1 - alpha / 2), zb = normInv(power), pb = (p1 + p2) / 2;
    return Math.ceil((za * Math.sqrt(2 * pb * (1 - pb)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p2 - p1) ** 2);
  }

  // ---------- 3b. Creative ----------
  function attributeEffects(variants) {
    const totC = sum(variants.map((v) => v.conversions)), totI = sum(variants.map((v) => v.impressions)) || 1, base = totC / totI;
    const out = {};
    for (const attr of ["hook", "cta", "format"]) {
      const agg = {};
      variants.forEach((v) => { const k = v[attr] || "(none)"; agg[k] = agg[k] || [0, 0]; agg[k][0] += v.conversions; agg[k][1] += v.impressions; });
      out[attr] = Object.entries(agg).map(([value, [c, i]]) => ({ value, rate: c / i, lift: base ? c / i / base - 1 : 0, impressions: i })).sort((a, b) => b.rate - a.rate);
    }
    return out;
  }
  function untestedCombos(variants, effects, n = 6) {
    const tested = new Set(variants.map((v) => [v.hook, v.cta, v.format].join("|")));
    const pool = { hook: effects.hook.slice(0, 3).map((x) => x.value), cta: effects.cta.slice(0, 2).map((x) => x.value), format: effects.format.slice(0, 2).map((x) => x.value) };
    const score = (attr, val) => (effects[attr].find((x) => x.value === val) || { lift: 0 }).lift;
    const out = [];
    for (const h of pool.hook) for (const c of pool.cta) for (const f of pool.format) {
      if (tested.has([h, c, f].join("|"))) continue;
      out.push({ hook: h, cta: c, format: f, score: score("hook", h) + score("cta", c) + score("format", f) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, n);
  }
  function fatigue(series, { window = 7, dropPct = 0.15 } = {}) {
    return series.map((s) => {
      const first = mean(s.ctr.slice(0, window)), last = mean(s.ctr.slice(-window));
      const drop = first ? (first - last) / first : 0;
      return { ...s, first, last, drop, fatigued: s.ctr.length >= 2 * window && drop >= dropPct };
    });
  }

  // ---------- 4. Guardrails ----------
  function robustZ(series, value) {
    const med = median(series); const mad = median(series.map((x) => Math.abs(x - med))) * 1.4826 || std(series) || 1;
    return (value - med) / mad;
  }
  function anomalies(channels, { z = 3.5 } = {}) {
    const out = [];
    channels.forEach((c) => {
      const n = c.spend.length; if (n < 8) return;
      if (!(c.spend[n - 1] > 0)) return;
      const idx = c.spend.slice(0, -1).map((v, i) => i).filter((i) => c.spend[i] > 0);
      if (idx.length < 7) return;
      const hs = idx.map((i) => c.spend[i]), hr = idx.map((i) => c.revenue[i] / c.spend[i]);
      const zs = robustZ(hs, c.spend[n - 1]), lr = c.revenue[n - 1] / c.spend[n - 1], zr = robustZ(hr, lr);
      const collapsed = zr < -z || (zr < -2 && lr < 0.5 * median(hr)); // big relative drop even when ROAS is noisy
      if (zs > z && collapsed) out.push({ id: c.id, label: c.label, severity: "critical", title: "Spend spike with ROAS collapse", detail: `Spend is ${zs.toFixed(1)}σ above normal while ROAS fell to ${lr.toFixed(2)} (${zr.toFixed(1)}σ). Check conversion tracking, bid strategy changes and invalid traffic.`, freeze: true, zs, zr });
      else if (zs > z) out.push({ id: c.id, label: c.label, severity: "warn", title: "Spend spike", detail: `Spend is ${zs.toFixed(1)}σ above its usual level.`, zs, zr });
      else if (collapsed) out.push({ id: c.id, label: c.label, severity: "warn", title: "ROAS drop", detail: `ROAS is ${Math.abs(zr).toFixed(1)}σ below its usual level.`, zs, zr });
    });
    return out;
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean); if (!lines.length) return [];
    const split = (l) => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((s) => s.trim()); };
    const head = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    return lines.slice(1).map((l) => { const v = split(l); return Object.fromEntries(head.map((h, i) => [h, v[i]])); });
  }
  function toCSV(rows, cols) {
    const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  }

  const Engine = { rng, sum, mean, median, std, betaPdf, normInv, hill, CHANNELS, AUD_FEATURES, AUD_LABELS,
    sampleChannels, sampleKeywords, sampleAudience, sampleVariants, sampleCreativeCtr, channelFatigue,
    isoDay, addDays, dayDiff, yesterday, windowed, performance,
    fitCurve, curveRev, curveMarginal, optimizeBudget, intent, kmeans, silhouette, analyzeKeywords, segmentAudience,
    analyzeAB, sampleSize, attributeEffects, untestedCombos, fatigue, robustZ, anomalies, parseCSV, toCSV };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine; else root.Engine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
