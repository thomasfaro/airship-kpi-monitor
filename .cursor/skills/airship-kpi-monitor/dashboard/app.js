/*
 * Airship KPI Monitor — local dashboard renderer.
 * Vanilla JS, no dependencies. Reads window.AIRSHIP_KPI_DATA (set by
 * dashboard-data.js or the committed dashboard-data.sample.js).
 *
 * Two run modes:
 *  - Static (file:// or no server): read-only. Mute / Unmute / threshold edits
 *    copy a ready-to-paste prompt for Cursor chat.
 *  - Served (serve.py on http://127.0.0.1:8787): the page probes /api/state and,
 *    when reachable, applies Mute / Unmute, per-project threshold edits, and the
 *    Setup routing CRUD directly by POSTing to the local server (which round-trips
 *    the local, gitignored clients.yml). Never any secret either way.
 */
(function () {
  "use strict";

  var DEFAULTS = { slackWorkspace: "urbanairship", slackTeamId: "T025Q1VP7" };

  var SEV = {
    danger: { label: "Critical", rank: 0, pill: "pill--danger", row: "row--danger" },
    warning: { label: "Watch", rank: 1, pill: "pill--warning", row: "row--warning" },
    info: { label: "Info", rank: 2, pill: "pill--info", row: "row--info" },
  };

  // Benchmark verticals (industry). Used to position KPIs vs market peers on the
  // Slack canvas. The server sends the authoritative list (from benchmarks.json);
  // this is the offline fallback so the picker works under file:// too.
  var VERTICALS_FALLBACK = {
    all_verticals: "All_verticals",
    business: "Business",
    charities_foundations_and_non_profit: "Charities, Foundations, and Non-Profit",
    education: "Education",
    entertainment: "Entertainment",
    finance_insurance: "Finance & Insurance",
    food_drink: "Food & Drink",
    gambling_gaming: "Gambling, Gaming",
    government: "Government",
    media: "Media",
    medical_health_fitness: "Medical, Health & Fitness",
    retail: "Retail",
    social: "Social",
    sports_recreation: "Sports & Recreation",
    travel_transportation: "Travel & Transportation",
    utility_productivity: "Utility & Productivity",
  };
  function verticals() {
    return (APP.state && APP.state.verticals && Object.keys(APP.state.verticals).length)
      ? APP.state.verticals
      : VERTICALS_FALLBACK;
  }
  function verticalLabel(slug) {
    if (!slug) return "";
    var v = verticals();
    return v[slug] || slug;
  }
  function verticalOptions(selected) {
    var v = verticals();
    return Object.keys(v).map(function (slug) {
      return '<option value="' + esc(slug) + '"' + (slug === selected ? " selected" : "") + ">" + esc(v[slug]) + "</option>";
    }).join("");
  }
  // Resolve a project's current industry from live server state first, then the
  // run snapshot (p.industry written by the skill).
  function projIndustry(p) {
    var c = stateClient(p.name);
    if (c && c.industry) return c.industry;
    return p.industry || "";
  }

  // Mutable app state shared across renders.
  var APP = { data: null, serverMode: false, state: null, route: { name: "list" } };

  // Channel buckets for the deep project page KPI panels (ordered top→bottom).
  // `group`/`channel` on each metric maps here; keys mirror the thresholds catalog.
  var CHANNEL_GROUPS = [
    { id: "app", label: "App & engagement" },
    { id: "push", label: "Push" },
    { id: "acquisition", label: "Acquisition & opt-ins" },
    { id: "email", label: "Email" },
    { id: "web", label: "Web push" },
    { id: "sms", label: "SMS" },
  ];

  // --- helpers ---------------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  // Deep links open the Slack desktop app directly — no browser redirect chain.
  function canvasLink(data, id) {
    return "slack://file?team=" + encodeURIComponent(data.slackTeamId) + "&id=" + encodeURIComponent(id);
  }
  function channelLink(data, channel) {
    return "https://" + encodeURIComponent(data.slackWorkspace) + ".slack.com/app_redirect?channel=" + encodeURIComponent(channel);
  }
  function worstOf(severities) {
    var w = null;
    severities.forEach(function (s) {
      if (s && (w === null || SEV[s].rank < SEV[w].rank)) w = s;
    });
    return w;
  }
  // Normalise a project's alert state. When `alertsList` is present it is the
  // source of truth (muted entries are excluded from the active count and from
  // the worst severity); otherwise fall back to the summary `alerts` object.
  function projAlerts(p) {
    var list = (p.alertsList || []).filter(function (a) { return a && a.key; });
    if (list.length) {
      var active = list.filter(function (a) { return !a.muted; });
      var muted = list.filter(function (a) { return a.muted; });
      return {
        count: active.length,
        mutedCount: muted.length,
        worst: worstOf(active.map(function (a) { return a.severity; })),
        list: list,
      };
    }
    var a = p.alerts || {};
    return { count: a.count || 0, mutedCount: a.mutedCount || 0, worst: a.worstSeverity || null, list: null };
  }

  // --- hash router -----------------------------------------------------------
  // #/            → flotte list (Monitor)
  // #/setup       → routing registry (Setup)
  // #/project/<name> → deep project page
  function parseRoute() {
    var h = String(location.hash || "").replace(/^#\/?/, "");
    if (!h) return { name: "list" };
    if (h === "setup") return { name: "setup" };
    var m = h.match(/^project\/(.+)$/);
    if (m) { try { return { name: "project", project: decodeURIComponent(m[1]) }; } catch (e) { return { name: "project", project: m[1] }; } }
    return { name: "list" };
  }
  function navTo(hash) {
    if (location.hash === hash) rerender(); else location.hash = hash; // hashchange → rerender
  }
  function findProject(data, name) {
    var t = String(name || "").trim().toLowerCase();
    var clients = data.clients || [];
    for (var i = 0; i < clients.length; i++) {
      var ps = clients[i].projects || [];
      for (var j = 0; j < ps.length; j++) {
        if (String(ps[j].name || "").trim().toLowerCase() === t) return { client: clients[i], project: ps[j] };
      }
    }
    return null;
  }

  // --- number & metric formatting -------------------------------------------
  function fmt1(n) {
    var v = Number(n);
    if (isNaN(v)) return "\u2014";
    return (Math.round(v * 10) / 10).toString();
  }
  // Compact count formatting (1.24M, 12.3K). Used for volume metrics.
  function fmtCount(n) {
    if (n == null || isNaN(n)) return "\u2014";
    var a = Math.abs(n);
    if (a >= 1e9) return trimZeros((n / 1e9).toFixed(2)) + "B";
    if (a >= 1e6) return trimZeros((n / 1e6).toFixed(2)) + "M";
    if (a >= 1e3) return trimZeros((n / 1e3).toFixed(1)) + "K";
    return String(Math.round(n));
  }
  function trimZeros(s) { return String(s).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"); }
  // Adaptive precision for a number whose meaning lives in its decimals. Rounding
  // a 0.083% block-bounce headroom to one decimal prints "0.083" as "0.1" next to
  // a "0.1" threshold — a healthy margin rendered as an exhausted one. Scale the
  // decimals to the magnitude instead, so the small deliverability rates keep the
  // digits that carry the signal.
  function fmtPrec(n) {
    var v = Number(n);
    if (n == null || isNaN(v)) return "\u2014";
    var a = Math.abs(v);
    if (a === 0) return "0";
    // A rate approaching 100 carries its meaning in the distance from 100, exactly
    // as a rate near 0 does: 99.973% delivery rounded to "100%" claims a perfection
    // it has not reached and hides 27 failures per 100,000. Let the complement set
    // the precision there.
    var base = a < 1 ? 3 : (a > 99 && a < 100) ? (100 - a < 0.1 ? 3 : 2) : a < 10 ? 2 : 1;
    var s = trimZeros(v.toFixed(base));
    // Rounding must never manufacture a whole number out of a measured one: an
    // open rate of 29.983% printed as "30%" reads as an exact figure and
    // contradicts the analysis text beside it. Add decimals until the value stops
    // pretending to be round.
    if (v % 1 !== 0) {
      for (var d = base; d <= base + 2 && s.indexOf(".") === -1; d++) s = trimZeros(v.toFixed(d));
    }
    return s;
  }
  // A run writes `unit: "pct"` on the metric while the thresholds catalog spells
  // the same unit "%". A renderer that knows only one of the two does not fail
  // loudly — it falls through to the count formatter, which is how the entire
  // email family came to print 99.726% as a bare "100". Read units through here.
  function normUnit(u) {
    var s = String(u == null ? "" : u).toLowerCase();
    return (s === "pct" || s === "%" || s === "percent") ? "%" : s;
  }
  // Value formatting driven by the metric's own unit (the unit of current/previous).
  function fmtVal(v, unit) {
    if (v == null || isNaN(v)) return "\u2014";
    unit = normUnit(unit);
    if (unit === "%") {
      // Deliverability rates live near zero (a 0.001% complaint rate is the
      // healthy case). One decimal would round them all to "0%" and hide the
      // very signal being monitored, so precision follows the magnitude.
      return fmtPrec(v) + "%";
    }
    if (unit === "pts") return fmt1(v) + " pts";
    if (unit === "min") return fmt1(v) + " min";
    if (unit === "x") return (Math.round(v * 100) / 100).toFixed(2) + "x";
    return fmtCount(v);
  }
  // Window delta chip (30d vs previous 30d). Points (deltaPts) for rate metrics, percent (deltaPct) else.
  function deltaChip(m) {
    var v, u;
    if (typeof m.deltaPts === "number") { v = m.deltaPts; u = " pts"; }
    else if (typeof m.deltaPct === "number") { v = m.deltaPct; u = "%"; }
    else return "";
    var dir = v > 0 ? "up" : v < 0 ? "down" : "flat";
    var arrow = v > 0 ? "\u25B2" : v < 0 ? "\u25BC" : "\u2013";
    // A real move on a near-zero rate (0.008% → 0.001% complaints) must not print
    // as "0 pts"; keep enough decimals for the change to stay visible.
    var a = Math.abs(v);
    var txt = a > 0 && a < 0.1 ? trimZeros(a.toFixed(3)) : a > 0 && a < 1 ? trimZeros(a.toFixed(2)) : fmt1(a);
    return '<span class="delta delta--' + dir + '">' + arrow + " " + txt + u + "</span>";
  }
  var MSTATUS = {
    ok: { t: "OK", c: "ok" },
    candidate: { t: "Watching", c: "cand" },
    confirmed: { t: "Alert", c: "danger" },
    off: { t: "Alerts off", c: "muted" },
    // Dismissing is the TAM saying "handled" — a false positive, or a threshold
    // they just adjusted. The card returns to OK rather than staying dimmed, which
    // read as "disabled". What was dismissed stays legible without the grey: the
    // Undismiss button remains on the card, the cause line still names the breach,
    // and the chip's tooltip says the occurrence was acknowledged.
    dismissed: { t: "OK", c: "ok" },
    na: { t: "n/a", c: "na" },
  };
  // A run writes `status: "breach"`; this file's vocabulary is ok/candidate/
  // confirmed/na. `MSTATUS[s] || MSTATUS.ok` turned every unknown word into a
  // green "OK", so 22 breaching metrics advertised themselves as healthy. Map the
  // producer's words explicitly and treat anything still unknown as alerting —
  // a status we cannot read is not evidence of health.
  var STATUS_ALIAS = {
    breach: "confirmed", breaching: "confirmed", alert: "confirmed", alerting: "confirmed",
    danger: "confirmed", critical: "confirmed", warning: "candidate", watch: "candidate",
    watching: "candidate", cand: "candidate", muted: "off", disabled: "off",
    ok: "ok", healthy: "ok", candidate: "candidate", confirmed: "confirmed", na: "na", "n/a": "na",
  };
  function normStatus(s) {
    var k = String(s == null ? "" : s).toLowerCase().trim();
    if (!k) return "";
    return STATUS_ALIAS[k] || (MSTATUS[k] ? k : "confirmed");
  }

  // Volume KPIs whose alerts are raised on a FALL only. A spike in app opens, time
  // in app or push sends is a campaign, a launch or a news cycle — not a platform
  // fault, and nothing a TAM can action. Filtering here rather than trusting every
  // producer keeps the rule true for snapshots written before it existed.
  var DROP_ONLY_METRICS = { app_opens: 1, timeinapp: 1, time_in_app: 1, push_sends: 1 };
  function isDropAlertKey(key) { return /_drop(_|$)/.test(String(key || "").toLowerCase()); }

  // The three independent facts behind a card, previously collapsed into one
  // `status` string:
  //   off       — the TAM turned this guard off for this client, for good. A
  //               setting, not a state of the KPI, so it never counts as severity.
  //   dismissed — the TAM acknowledged THIS occurrence. Keyed on the alert's
  //               openedAt, so a later re-opening is raised again.
  //   alerting  — a guard is breaching now.
  function metricAlertState(p, m) {
    var alerts = alertsForMetric(p, m);
    var offMap = mutedMap(p.name, p);
    var dis = dismissedAlerts(p.name, p);
    var tKey = (m.threshold && m.threshold.key) || m.key;
    var off = !!(offMap[tKey] || alerts.some(function (a) { return a.muted; }) ||
      alerts.some(function (a) { return offMap[a.key]; }));
    var live = alerts.filter(function (a) { return !a.muted && !offMap[a.key]; });
    var dismissed = live.filter(function (a) { return isDismissed(dis, a); });
    var active = live.filter(function (a) { return !isDismissed(dis, a); });
    var declared = normStatus(m.status);
    var breaching = !!(m.threshold && m.threshold.breaching);
    var cands = candidatesForMetric(p, m);
    // Honour the confirmation gate (SKILL.md Step 8a): a fresh breach is a
    // CANDIDATE until it has persisted, so a breaching threshold with no confirmed
    // alert behind it reads "Watching", not "Alert". Both are non-OK, which is the
    // point — but calling an unconfirmed breach an alert would undo the gate on
    // screen after the run was careful to apply it.
    var status;
    if (declared === "na") status = "na";
    else if (off) status = "off";
    else if (active.length) status = "confirmed";
    else if (dismissed.length) status = "dismissed";
    else if (cands.length || breaching || declared === "candidate") status = "candidate";
    else if (declared === "confirmed") status = "confirmed";
    else status = "ok";
    var sev = active.length
      ? (active.some(function (a) { return a.severity === "danger"; }) ? "danger" : "warning")
      : status === "confirmed" ? "danger" : "warning";
    return { status: status, sev: sev, off: off, active: active, dismissed: dismissed,
      candidates: cands, alerts: alerts, breaching: breaching };
  }
  // Candidate breaches waiting on the confirmation gate, matched to a metric the
  // same way alerts are.
  function candidatesForMetric(p, m) {
    if (!m || !m.key) return [];
    var mk = m.key.toLowerCase().replace(/_rate$/, "");
    var alt = _ALERT_ALT[m.key];
    var dropOnly = DROP_ONLY_METRICS[m.key];
    return (p.candidatesList || []).filter(function (a) {
      if (!a || !a.key) return false;
      var ak = a.key.toLowerCase();
      if (ak.indexOf(mk) === -1 && !(alt && ak.indexOf(alt) !== -1)) return false;
      return dropOnly ? isDropAlertKey(ak) : true;
    });
  }
  // Every metric currently raising an alert, worst first. This is the list both
  // the project banner and the fleet row are built from, so a dot on the list page
  // and a row in the banner can never disagree about what is wrong.
  function alertingMetrics(p) {
    var out = [];
    (p.metrics || []).forEach(function (m) {
      if (!m || !m.key) return;
      var st = metricAlertState(p, m);
      // Confirmed only. A candidate is a breach the confirmation gate (SKILL.md
      // Step 8a) has not yet accepted, so listing it beside real alerts on the
      // fleet list and the project banner undoes the gate on screen and puts
      // "watching" rows under a heading that reads as critical. Candidates stay
      // visible on their own card and in the separate count.
      if (st.status !== "confirmed") return;
      out.push({ metric: m, state: st, sev: st.sev });
    });
    // Metric keys overlap: `email_unsubscribe` and `email_unsubscribe_rate` both
    // claim an `email_unsubscribe_rise` alert, which would list one problem twice
    // and inflate the dot count. Give each alert to the single card whose own
    // threshold key shares the longest prefix with it, and drop cards left with
    // nothing of their own.
    var owner = {};
    out.forEach(function (e) {
      var tk = String((e.metric.threshold && e.metric.threshold.key) || e.metric.key).toLowerCase();
      e.state.active.forEach(function (a) {
        var ak = String(a.key || "").toLowerCase();
        var score = 0;
        while (score < ak.length && score < tk.length && ak[score] === tk[score]) score++;
        if (!owner[ak] || score > owner[ak].score) owner[ak] = { score: score, key: e.metric.key };
      });
    });
    out = out.filter(function (e) {
      var mine = e.state.active;
      if (!mine.length) return true;
      return mine.some(function (a) {
        var o = owner[String(a.key || "").toLowerCase()];
        return !o || o.key === e.metric.key;
      });
    });
    out.sort(function (a, b) {
      if (a.sev !== b.sev) return a.sev === "danger" ? -1 : 1;
      return String(a.metric.label || a.metric.key).localeCompare(String(b.metric.label || b.metric.key));
    });
    return out;
  }
  function metricStatus(p, m) {
    // Tolerate the legacy one-argument call: metricStatus(m).
    if (m === undefined) { m = p; p = null; }
    if (!p) return MSTATUS[normStatus(m.status) || (m.threshold && m.threshold.breaching ? "confirmed" : "ok")] || MSTATUS.ok;
    return MSTATUS[metricAlertState(p, m).status] || MSTATUS.ok;
  }
  function statusChip(p, m) {
    var st = m === undefined ? metricAlertState(null, p) : metricAlertState(p, m);
    var i = MSTATUS[st.status] || MSTATUS.ok;
    var title = st.status === "off" ? "Alerts are turned off for this KPI on this client"
      : st.status === "dismissed" ? "This occurrence was dismissed; a new one will be raised again"
      : st.active.length ? st.active.map(function (a) { return a.key; }).join(", ")
      : "";
    return '<span class="mstatus mstatus--' + i.c + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(i.t) + "</span>";
  }
  // The run window is a {current:{start,end},previous:{start,end}} object; older
  // snapshots stored it as a plain string. Render both without stringifying an
  // object into "[object Object]".
  function windowText(w) {
    if (!w) return "";
    if (typeof w === "string") return w;
    var c = w.current || {};
    var p = w.previous || {};
    var cur = c.start && c.end ? c.start + " \u2192 " + c.end : "";
    var prev = p.start && p.end ? p.start + " \u2192 " + p.end : "";
    if (!cur) return "";
    return cur + (prev ? " vs " + prev : "");
  }
  // Headroom gauge: fill = distance already travelled toward the breach; a marker
  // sits at the threshold (right edge). headroom is signed (positive = safe margin,
  // negative = breaching), in the metric's own unit — see SKILL.md Step 13.
  function headroomGauge(t, unit) {
    if (!t || typeof t.headroom !== "number") return "";
    var T = Math.abs(Number(t.value));
    var H = Number(t.headroom);
    var frac = T > 0 ? (T - H) / T : (t.breaching ? 1 : 0.5);
    frac = Math.max(0, Math.min(1.06, frac));
    var pct = Math.min(100, frac * 100);
    var cls = t.breaching ? "gauge--danger" : (frac >= 0.75 ? "gauge--warning" : "gauge--ok");
    var nu = normUnit(unit);
    var u = nu === "pts" ? " pts" : nu === "%" ? "%" : "";
    // An alert can be raised by a guard this card does not carry. This is the norm
    // for the email fast checks (delay, spam, deliverability, bounce): they fire on
    // recent DAYS while the card shows the 30-day window figure, so a healthy-looking
    // monthly rate can sit beside an active alert. Same for a rise/collapse guard on
    // a family whose card carries the drop guard. In
    // that case `breaching` is true while headroom is still positive — say so
    // instead of printing a negative breach ("Breaching by -6.8").
    var otherGuard = t.breaching && H >= 0;
    var cap;
    if (otherGuard) {
      cap = "Alert active \u00B7 this guard still has " + fmtPrec(H) + u + " of headroom (threshold " +
        fmtPrec(t.value) + u + ") \u2014 raised by another guard";
    } else if (t.breaching) {
      cap = "Breaching by " + fmtPrec(-H) + u + " \u00B7 threshold " + fmtPrec(t.value) + u;
    } else {
      cap = "Headroom " + fmtPrec(H) + u + " \u00B7 threshold " + fmtPrec(t.value) + u + (t.kind ? " (" + esc(t.kind) + ")" : "");
    }
    return (
      '<div class="gauge ' + cls + '">' +
        '<div class="gauge__track">' +
          '<div class="gauge__fill" style="width:' + pct.toFixed(0) + '%"></div>' +
          '<div class="gauge__mark" title="Alert threshold"></div>' +
        "</div>" +
        '<div class="gauge__cap">' + cap + "</div>" +
      "</div>"
    );
  }
  // The metric closest to breaching — the project's weakest point.
  //
  // `headroom` is expressed in each metric's OWN unit (%, pts, counts, x) against
  // thresholds spanning 0.5 to 100, so raw headroom is not comparable across
  // metrics: a 0.5% click-rate floor sitting on a wide margin would always rank
  // "worse" than a 100% send-drop guard on a thin one. Rank on the RELATIVE margin
  // (headroom / |threshold|), which is unit-free and scale-free.
  function relativeMargin(t) {
    var T = Math.abs(Number(t.value));
    if (!isFinite(T) || T === 0) return Number(t.headroom);
    return Number(t.headroom) / T;
  }
  function worstHeadroomMetric(p) {
    var ms = (p.metrics || []).filter(function (m) { return m && m.threshold && typeof m.threshold.headroom === "number"; });
    if (!ms.length) return null;
    ms.sort(function (a, b) { return relativeMargin(a.threshold) - relativeMargin(b.threshold); });
    return ms[0];
  }
  function catalogItem(key) {
    var cat = window.AIRSHIP_KPI_THRESHOLDS || { items: [] };
    var items = cat.items || [];
    for (var i = 0; i < items.length; i++) if (items[i].key === key) return items[i];
    return null;
  }

  // Canonical prompts the agent recognises (see SKILL.md).
  function mutePrompt(project, key, reason) {
    return 'Mute airship-kpi-monitor alert "' + key + '" for project "' + project +
      '" (false positive). Reason: ' + (reason && String(reason).trim() ? reason : "<why it\u2019s a false positive>");
  }
  function unmutePrompt(project, key) {
    return 'Unmute airship-kpi-monitor alert "' + key + '" for project "' + project + '"';
  }
  function setThresholdPrompt(project, key, value) {
    return 'Set airship-kpi-monitor threshold "' + key + '" to ' + value + ' for project "' + project + '"';
  }
  function resetThresholdPrompt(project, key) {
    return 'Reset airship-kpi-monitor threshold "' + key + '" to default for project "' + project + '"';
  }
  function setIndustryPrompt(project, industry) {
    return 'Set airship-kpi-monitor industry to "' + industry + '" for project "' + project + '"';
  }
  function dismissSuggestionPrompt(project, key) {
    return 'Dismiss airship-kpi-monitor threshold suggestion "' + key + '" for project "' + project +
      '" (do not re-emit it on the next run)';
  }
  // `watched_alerts` stays the clients.yml key (runs read it back); "context" is
  // the only word the UI uses for it.
  function contextPrompt(project, key, reason) {
    return 'Set airship-kpi-monitor context on KPI "' + key + '" for project "' + project +
      '" (clients.yml watched_alerts, kept across runs). Context: ' +
      (reason && String(reason).trim() ? reason : "<what a reader should know about this KPI on this client>");
  }
  function dismissAlertPrompt(project, key) {
    return 'Dismiss the currently open airship-kpi-monitor alert "' + key + '" for project "' + project +
      '" (this occurrence only \u2014 add it to clients.yml dismissed_alerts pinned to its openedAt; ' +
      "a later re-opening must be raised again)";
  }
  function undismissAlertPrompt(project, key) {
    return 'Undismiss the airship-kpi-monitor alert "' + key + '" for project "' + project +
      '" (remove it from clients.yml dismissed_alerts)';
  }
  // Stable in-page anchor so the project banner can link straight to a KPI card.
  function metricAnchor(m) {
    return "kpi-" + String((m && (m.key || (m.threshold && m.threshold.key))) || "x")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }
  function runPrompt() {
    return "Run the airship-kpi-monitor skill for every project in my clients.yml and refresh the local dashboard.";
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  // file:// is not always a secure context for the async clipboard API.
  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  // --- server API ------------------------------------------------------------
  function probe() {
    if (location.protocol === "file:") return Promise.resolve();
    return fetch("/api/state", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("no server"); return r.json(); })
      .then(function (j) {
        if (j && j.ok && j.state) { APP.serverMode = true; APP.state = j.state; }
      })
      .catch(function () { /* static mode */ });
  }
  function api(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (o) {
        if (!o.r.ok || !o.j || !o.j.ok) throw new Error((o.j && o.j.error) || ("HTTP " + o.r.status));
        if (o.j.state) APP.state = o.j.state;
        return o.j;
      });
  }
  // Aliases for matching dashboard project names to clients.yml (see serve.py).
  function projectNameAliases(name) {
    var n = String(name || "").trim().toLowerCase();
    var aliases = [n];
    if (n.slice(-5) === " prod") aliases.push(n.slice(0, -5).replace(/\s+$/, ""));
    else aliases.push(n + " prod");
    return aliases;
  }
  function namesMatchProject(c, aliases) {
    var cname = String(c.name || "").toLowerCase();
    var bname = String(c.brand_name || "").toLowerCase();
    for (var i = 0; i < aliases.length; i++) {
      if (cname === aliases[i] || (bname && bname === aliases[i])) return true;
    }
    return false;
  }
  // Find a project's live routing entry in the server state (by name/brand).
  function stateClient(name) {
    if (!APP.state || !APP.state.clients) return null;
    var aliases = projectNameAliases(name);
    for (var i = 0; i < APP.state.clients.length; i++) {
      if (namesMatchProject(APP.state.clients[i], aliases)) return APP.state.clients[i];
    }
    return null;
  }
  function serverOverrides(project) {
    var c = stateClient(project);
    return (c && c.custom_thresholds) || {};
  }
  // Dismissed threshold-suggestion keys for a project (live server state first,
  // then the run snapshot). Suggestions in this set are hidden from both the
  // inline card and the orphan-suggestions table.
  function dismissedSet(project, p) {
    var out = {};
    var c = stateClient(project);
    var lists = [(c && c.dismissed_suggestions) || [], (p && p.dismissedSuggestions) || []];
    lists.forEach(function (l) { (l || []).forEach(function (k) { if (k) out[String(k)] = true; }); });
    return out;
  }
  // Manually-watched KPIs for a project (live server state + run snapshot),
  // keyed by threshold key. Returns { key: { key, reason, since } }.
  function watchedMap(project, p) {
    var out = {};
    function add(w) {
      if (!w) return;
      var k = w.key || w.threshold || w;
      if (k) out[String(k)] = { key: String(k), reason: w.reason || "", since: w.since || "" };
    }
    var c = stateClient(project);
    ((c && c.watched_alerts) || []).forEach(add);
    ((p && p.watchedAlerts) || []).forEach(add);
    return out;
  }
  // KPIs whose alerts the TAM turned off for this client, for good
  // (clients.yml `muted_alerts`). Keyed by threshold key AND alert key, because a
  // guard is muted by its threshold key while the alerts it raises carry
  // per-OS suffixes.
  function mutedMap(project, p) {
    var out = {};
    function add(w) {
      if (!w) return;
      var k = w.key || w;
      if (k) out[String(k)] = { key: String(k), reason: w.reason || "", since: w.since || w.muted_since || "" };
    }
    var c = stateClient(project);
    ((c && c.muted_alerts) || []).forEach(add);
    ((p && p.alertsList) || []).forEach(function (a) { if (a && a.muted) add(a); });
    return out;
  }
  // One-shot acknowledgements (clients.yml `dismissed_alerts`). Each entry pins
  // the occurrence it dismissed via `opened`; when the alert resolves and a new
  // one opens on a later date the entry no longer matches, so the alert comes
  // back rather than being silenced for ever. That is the whole difference
  // between this and turning the guard off.
  function dismissedAlerts(project, p) {
    var out = {};
    function add(w) {
      if (!w || !w.key) return;
      out[String(w.key)] = { key: String(w.key), opened: w.opened || "", since: w.since || "", reason: w.reason || "" };
    }
    var c = stateClient(project);
    ((c && c.dismissed_alerts) || []).forEach(add);
    ((p && p.dismissedAlerts) || []).forEach(add);
    return out;
  }
  function isDismissed(map, a) {
    if (!a || !a.key) return false;
    var d = map[a.key];
    if (!d) return false;
    // No pinned occurrence (hand-written entry) dismisses whatever is open now.
    return !d.opened || !a.openedAt || String(d.opened) === String(a.openedAt);
  }
  // Reflect a mute change immediately in the in-memory run data so the Monitor
  // view updates without waiting for the next skill run.
  function applyMuteLocal(project, key, muted, reason) {
    var data = APP.data;
    (data.clients || []).forEach(function (c) {
      (c.projects || []).forEach(function (p) {
        if (String(p.name).toLowerCase() !== String(project).toLowerCase()) return;
        (p.alertsList || []).forEach(function (a) {
          if (a.key === key || (a.key && a.key.split(":")[0] === key)) {
            a.muted = muted;
            if (muted) { if (reason) a.reason = reason; } else { delete a.reason; }
          }
        });
        // Keep the KPI tile's own status in sync: the card grey/active state is
        // driven by metricStatus(m) → m.status, NOT by alertsList. Without this,
        // an unmuted tile stays greyed (and a muted one never greys).
        (p.metrics || []).forEach(function (m) {
          var owns = alertsForMetric(p, m).some(function (a) {
            return a.key === key || (a.key && a.key.split(":")[0] === key);
          });
          if (!owns) return;
          if (muted) {
            m.status = "muted";
          } else {
            var stillAlerting = alertsForMetric(p, m).some(function (a) { return !a.muted; });
            m.status = stillAlerting ? "confirmed"
              : (m.threshold && m.threshold.breaching ? "confirmed" : "ok");
          }
        });
      });
    });
  }

  // --- toast + modal ---------------------------------------------------------
  function toast(msg, kind) {
    var t = el('<div class="toast' + (kind ? " toast--" + kind : "") + '"></div>');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); setTimeout(function () { t.remove(); }, 300); }, 2600);
  }
  // Lightweight modal builder. actions: [{label, primary, onClick(close, dialog, status)}].
  function modal(opts) {
    var overlay = el('<div class="overlay"></div>');
    var dialog = el('<div class="dialog" role="dialog" aria-modal="true"></div>');
    var head = el('<div class="dialog__head"><h3></h3><button class="dialog__x" type="button" aria-label="Close">\u2715</button></div>');
    head.querySelector("h3").textContent = opts.title || "";
    dialog.appendChild(head);
    var body = el('<div class="dialog__body"></div>');
    body.innerHTML = opts.bodyHtml || "";
    dialog.appendChild(body);
    var actions = el('<div class="dialog__actions"></div>');
    var status = el('<span class="dialog__status"></span>');
    function close() { overlay.remove(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    (opts.actions || []).forEach(function (a) {
      var b = el('<button type="button" class="btn' + (a.primary ? " btn--primary" : "") + '"></button>');
      b.textContent = a.label;
      b.addEventListener("click", function () { a.onClick(close, dialog, status); });
      actions.appendChild(b);
    });
    actions.appendChild(status);
    dialog.appendChild(actions);
    head.querySelector(".dialog__x").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    return { overlay: overlay, dialog: dialog, body: body, status: status, close: close };
  }
  function copyModal(title, text) {
    var m = modal({
      title: title,
      bodyHtml:
        '<p class="dialog__hint">This page can\u2019t change the config on its own (no local server running). ' +
        "Copy the prompt below and paste it into Cursor chat to apply it.</p>" +
        '<textarea class="dialog__text" readonly rows="4"></textarea>',
      actions: [
        { label: "Copy to clipboard", primary: true, onClick: function (close, dlg, st) {
          copyText(text).then(function (ok) {
            st.textContent = ok ? "\u2713 Copied \u2014 paste into Cursor chat" : "Copy failed \u2014 select the text and copy manually";
          });
        } },
      ],
    });
    var ta = m.dialog.querySelector(".dialog__text");
    ta.value = text;
    ta.focus();
    ta.select();
    return m;
  }

  // --- mute / unmute actions -------------------------------------------------
  function onMute(project, key, reason) {
    if (!APP.serverMode) { copyModal("Mute \u2014 paste into chat", mutePrompt(project, key, reason)); return; }
    var m = modal({
      title: "Mute alert",
      bodyHtml:
        '<p class="dialog__hint">Mark <code>' + esc(key) + "</code> on <strong>" + esc(project) + "</strong> as a false positive. " +
        "It stays visible (flagged Muted) and is excluded from severity counts until you unmute it.</p>" +
        '<label class="fld"><span>Reason</span>' +
        '<textarea class="dialog__text" id="mReason" rows="3" placeholder="Why is this a false positive?"></textarea></label>',
      actions: [
        { label: "Mute", primary: true, onClick: function (close, dlg, st) {
          var r = dlg.querySelector("#mReason").value.trim();
          st.textContent = "Saving\u2026";
          api("/api/mute", { project: project, key: key, reason: r })
            .then(function () { applyMuteLocal(project, key, true, r); close(); rerender(); toast("Muted " + key); })
            .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
        } },
      ],
    });
    if (reason) m.dialog.querySelector("#mReason").value = reason;
  }
  function onUnmute(project, key) {
    if (!APP.serverMode) { copyModal("Unmute \u2014 paste into chat", unmutePrompt(project, key)); return; }
    if (!window.confirm('Unmute "' + key + '" for ' + project + "? It will be monitored again.")) return;
    api("/api/unmute", { project: project, key: key })
      .then(function () { applyMuteLocal(project, key, false); rerender(); toast("Unmuted " + key); })
      .catch(function (e) { toast("Error: " + e.message, "danger"); });
  }

  // --- industry (benchmark vertical) editor ----------------------------------
  // Reflect an industry change immediately in the in-memory run data.
  function applyIndustryLocal(project, industry) {
    (APP.data.clients || []).forEach(function (c) {
      (c.projects || []).forEach(function (p) {
        if (String(p.name).toLowerCase() === String(project).toLowerCase()) p.industry = industry;
      });
    });
    var sc = stateClient(project);
    if (sc) sc.industry = industry;
  }
  function onIndustry(project, current) {
    var m = modal({
      title: "Industry \u2014 " + project,
      bodyHtml:
        '<p class="dialog__hint">Market vertical used to position this project\u2019s push/app KPIs ' +
        "against Airship benchmarks on the Slack canvas." +
        (APP.serverMode ? " Saved to your local clients.yml." : " No local server \u2014 this becomes a prompt to paste into Cursor chat.") + "</p>" +
        '<label class="fld"><span>Industry</span><select class="dialog__sel" id="indSel">' +
          verticalOptions(current || "all_verticals") +
        "</select></label>",
      actions: [
        { label: APP.serverMode ? "Save" : "Copy prompt", primary: true, onClick: function (close, dlg, st) {
          var slug = dlg.querySelector("#indSel").value;
          if (!APP.serverMode) { close(); copyModal("Industry \u2014 paste into chat", setIndustryPrompt(project, slug)); return; }
          st.textContent = "Saving\u2026";
          api("/api/client", { name: project, oldName: project, industry: slug })
            .then(function () { applyIndustryLocal(project, slug); close(); rerender(); toast("Industry set to " + verticalLabel(slug)); })
            .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
        } },
      ],
    });
  }

  // --- thresholds editor -----------------------------------------------------
  function openThresholds(project) {
    var cat = window.AIRSHIP_KPI_THRESHOLDS || { groups: [], items: [] };
    var overrides = serverOverrides(project);
    var byGroup = {};
    (cat.items || []).forEach(function (it) { (byGroup[it.group] = byGroup[it.group] || []).push(it); });

    var groupsHtml = (cat.groups || []).map(function (g) {
      var rows = (byGroup[g.id] || []).map(function (it) {
        var ov = overrides[it.key];
        var val = ov == null ? "" : ov;
        var unit = it.unit ? '<span class="thr__unit">' + esc(it.unit) + "</span>" : "";
        return (
          '<div class="thr' + (val !== "" ? " thr--override" : "") + '" data-key="' + esc(it.key) + '" data-default="' + esc(it.default) + '">' +
            '<div class="thr__main"><span class="thr__label">' + esc(it.label) + "</span>" +
              '<code class="thr__key">' + esc(it.key) + "</code></div>" +
            '<div class="thr__hint">' + esc(it.hint || "") + "</div>" +
            '<div class="thr__input">' +
              '<input type="number" step="any" inputmode="decimal" value="' + esc(val) + '" placeholder="' + esc(it.default) + '" />' +
              unit +
              '<button type="button" class="thr__reset" title="Reset to default">reset</button>' +
            "</div>" +
          "</div>"
        );
      }).join("");
      return '<fieldset class="thrgroup"><legend>' + esc(g.label) + "</legend>" + rows + "</fieldset>";
    }).join("");

    var hint = APP.serverMode
      ? "Edit any threshold below. Blank uses the default. Saved to your local clients.yml."
      : "This page is read-only (no local server). Changes are turned into prompts to paste into Cursor chat.";

    var m = modal({
      title: "Thresholds \u2014 " + project,
      bodyHtml:
        '<p class="dialog__hint">' + esc(hint) + "</p>" +
        '<div class="thrform">' + groupsHtml + "</div>",
      actions: [
        { label: APP.serverMode ? "Save changes" : "Copy prompts", primary: true, onClick: function (close, dlg, st) {
          var overridesOut = {};
          var prompts = [];
          var invalid = false;
          dlg.querySelectorAll(".thr").forEach(function (row) {
            var key = row.getAttribute("data-key");
            var def = parseFloat(row.getAttribute("data-default"));
            var cur = overrides[key];
            var input = row.querySelector("input");
            var raw = input.value.trim();
            if (raw === "") {
              if (cur != null) { overridesOut[key] = null; prompts.push(resetThresholdPrompt(project, key)); }
              return;
            }
            var num = Number(raw);
            if (isNaN(num)) { invalid = true; input.classList.add("bad"); return; }
            input.classList.remove("bad");
            if (num === def) {
              if (cur != null) { overridesOut[key] = null; prompts.push(resetThresholdPrompt(project, key)); }
            } else if (num !== cur) {
              overridesOut[key] = num; prompts.push(setThresholdPrompt(project, key, num));
            }
          });
          if (invalid) { st.style.color = "var(--danger)"; st.textContent = "Some values are not numbers."; return; }
          if (!Object.keys(overridesOut).length && !prompts.length) { st.textContent = "No changes."; return; }
          if (APP.serverMode) {
            st.textContent = "Saving\u2026";
            api("/api/thresholds", { project: project, overrides: overridesOut })
              .then(function () { close(); rerender(); toast("Thresholds updated for " + project); })
              .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
          } else {
            close();
            copyModal("Threshold changes \u2014 paste into chat", prompts.join("\n"));
          }
        } },
      ],
    });
    // per-row reset clears the input (→ default)
    m.dialog.querySelectorAll(".thr__reset").forEach(function (b) {
      b.addEventListener("click", function () {
        var row = b.closest(".thr");
        row.querySelector("input").value = "";
        row.classList.remove("thr--override");
      });
    });
  }

  // --- sparklines (inline SVG, no library) -----------------------------------
  function lineSparkline(values, w, h) {
    w = w || 132;
    h = h || 30;
    if (!values || values.length < 2) return "";
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var span = max - min || 1;
    var stepX = w / (values.length - 1);
    var pts = values.map(function (v, i) {
      var x = i * stepX;
      var y = h - 3 - ((v - min) / span) * (h - 6);
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    var area = "0," + h + " " + pts.join(" ") + " " + w + "," + h;
    return (
      '<svg class="sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' +
      '<polyline class="area" points="' + area + '"/>' +
      '<polyline points="' + pts.join(" ") + '"/>' +
      "</svg>"
    );
  }
  function barSparkline(values, worst, w, h) {
    w = w || 84;
    h = h || 24;
    // Need at least 3 runs for a meaningful micro-trend. With 1–2 points the
    // bars read as solid blocks (esp. when equal), which looks like noise — so
    // skip the sparkline until enough history has accumulated.
    if (!values || values.length < 3) return "";
    var max = Math.max.apply(null, values.concat([1]));
    var gap = 2;
    var bw = (w - gap * (values.length - 1)) / values.length;
    var cls = worst === "danger" ? "b--danger" : worst === "warning" ? "b--warning" : "";
    var bars = values
      .map(function (v, i) {
        var bh = Math.max(2, (v / max) * (h - 2));
        var x = i * (bw + gap);
        var y = h - bh;
        return '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1"/>';
      })
      .join("");
    return '<svg class="sparkbars" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" aria-hidden="true">' + bars + "</svg>";
  }

  // --- large interactive chart (click-to-expand from a tile sparkline) --------
  // Pure inline SVG + JS handlers (no library, no external assets → still valid
  // under file://). Uses the full {t,v} series so points carry dates: hover /
  // tap / arrow-keys reveal a tooltip (value + date); min & max are marked and
  // the date axis is labelled. The compact tile sparkline is left untouched.
  var CHART_GEO = { W: 860, H: 400, padL: 72, padR: 24, padT: 26, padB: 54 };
  function chartPoints(series) {
    var g = CHART_GEO;
    var vals = series.map(function (s) { return Number(s.v); });
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    var span = max - min || 1;
    var plotW = g.W - g.padL - g.padR, plotH = g.H - g.padT - g.padB;
    var n = series.length;
    return series.map(function (s, i) {
      var x = g.padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      var y = g.padT + (1 - (Number(s.v) - min) / span) * plotH;
      return { x: x, y: y, v: Number(s.v), t: s.t, i: i };
    });
  }
  function bigChartSvg(series, unit) {
    var g = CHART_GEO;
    var pts = chartPoints(series);
    if (!pts.length) return "";
    var vals = pts.map(function (p) { return p.v; });
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    var line = pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ");
    var area = g.padL + "," + (g.H - g.padB) + " " + line + " " + (g.W - g.padR) + "," + (g.H - g.padB);
    // 5 y-axis gridlines (min, 25%, mid, 75%, max) for tighter guidance
    var yFracs = [0, 0.25, 0.5, 0.75, 1];
    var grid = yFracs.map(function (frac) {
      var val = min + frac * (max - min);
      var y = g.padT + (1 - frac) * (g.H - g.padT - g.padB);
      return '<line class="bchart__grid" x1="' + g.padL + '" y1="' + y.toFixed(1) + '" x2="' + (g.W - g.padR) + '" y2="' + y.toFixed(1) + '"/>' +
        '<text class="bchart__ylbl" x="' + (g.padL - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + esc(fmtVal(val, unit)) + "</text>";
    }).join("");
    // Up to 5 evenly distributed x-axis date labels
    var nLabels = Math.min(5, pts.length);
    var xIdx = [];
    for (var k = 0; k < nLabels; k++) {
      var idx = Math.round(k * (pts.length - 1) / Math.max(nLabels - 1, 1));
      if (xIdx.indexOf(idx) === -1) xIdx.push(idx);
    }
    var xlabels = xIdx.map(function (i) {
      var p = pts[i];
      var d = parseDay(p.t);
      var lbl = d ? fmtDay(d) : (p.t || "");
      var anchor = i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
      return '<text class="bchart__xlbl" x="' + p.x.toFixed(1) + '" y="' + (g.H - g.padB + 20) + '" text-anchor="' + anchor + '">' + esc(lbl) + "</text>";
    }).join("");
    var maxP = pts.reduce(function (a, b) { return b.v > a.v ? b : a; });
    var minP = pts.reduce(function (a, b) { return b.v < a.v ? b : a; });
    var markers =
      '<circle class="bchart__mark bchart__mark--max" cx="' + maxP.x.toFixed(1) + '" cy="' + maxP.y.toFixed(1) + '" r="4"/>' +
      '<circle class="bchart__mark bchart__mark--min" cx="' + minP.x.toFixed(1) + '" cy="' + minP.y.toFixed(1) + '" r="4"/>';
    var dots = pts.map(function (p) { return '<circle class="bchart__dot" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3"/>'; }).join("");
    var summary = "Line chart of " + series.length + " points \u00B7 min " + fmtVal(min, unit) + " \u00B7 max " + fmtVal(max, unit);
    return (
      '<div class="bchart">' +
        '<svg class="bchart__svg" viewBox="0 0 ' + g.W + " " + g.H + '" preserveAspectRatio="xMidYMid meet" role="img" tabindex="0" aria-label="' + esc(summary) + '">' +
          '<polyline class="bchart__area" points="' + area + '"/>' +
          grid +
          '<polyline class="bchart__line" points="' + line + '"/>' +
          markers + dots +
          '<line class="bchart__cross" x1="0" y1="' + g.padT + '" x2="0" y2="' + (g.H - g.padB) + '" style="display:none"/>' +
          '<circle class="bchart__hot" r="5" style="display:none"/>' +
          xlabels +
        "</svg>" +
        '<div class="bchart__tip" role="status" aria-live="polite" hidden></div>' +
      "</div>"
    );
  }
  function openChart(title, unit, series) {
    var m = modal({ title: "History \u2014 " + title, bodyHtml: bigChartSvg(series, unit), actions: [] });
    wireChart(m.body, series, unit);
    return m;
  }
  function wireChart(root, series, unit) {
    var svg = root.querySelector(".bchart__svg");
    var tip = root.querySelector(".bchart__tip");
    var cross = root.querySelector(".bchart__cross");
    var hot = root.querySelector(".bchart__hot");
    if (!svg || !series.length) return;
    var pts = chartPoints(series);
    var g = CHART_GEO;
    var active = -1;
    function show(i) {
      if (i < 0 || i >= pts.length) return;
      active = i;
      var p = pts[i];
      cross.setAttribute("x1", p.x); cross.setAttribute("x2", p.x); cross.style.display = "";
      hot.setAttribute("cx", p.x); hot.setAttribute("cy", p.y); hot.style.display = "";
      var d = parseDay(p.t);
      var dlbl = d ? fmtDay(d) : (p.t || "");
      tip.hidden = false;
      tip.innerHTML = "<strong>" + esc(fmtVal(p.v, unit)) + "</strong>" + (dlbl ? ' <span class="bchart__tip-d">' + esc(dlbl) + "</span>" : "");
      tip.style.left = (p.x / g.W * 100) + "%";
      tip.style.top = (p.y / g.H * 100) + "%";
    }
    function nearest(clientX) {
      var rect = svg.getBoundingClientRect();
      var sx = (clientX - rect.left) / rect.width * g.W;
      var best = 0, bd = Infinity;
      pts.forEach(function (p) { var dd = Math.abs(p.x - sx); if (dd < bd) { bd = dd; best = p.i; } });
      return best;
    }
    svg.addEventListener("mousemove", function (e) { show(nearest(e.clientX)); });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; cross.style.display = "none"; hot.style.display = "none"; });
    svg.addEventListener("touchstart", function (e) { if (e.touches[0]) { show(nearest(e.touches[0].clientX)); e.preventDefault(); } }, { passive: false });
    svg.addEventListener("touchmove", function (e) { if (e.touches[0]) { show(nearest(e.touches[0].clientX)); e.preventDefault(); } }, { passive: false });
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { show(Math.max(0, (active < 0 ? pts.length : active) - 1)); e.preventDefault(); }
      else if (e.key === "ArrowRight") { show(Math.min(pts.length - 1, active + 1)); e.preventDefault(); }
    });
    svg.addEventListener("focus", function () { if (active < 0) show(pts.length - 1); });
  }

  // --- alert age ("how long has this been open") -----------------------------
  // An alert that was already present at the previous run shows a small age graph
  // (a horizontal duration bar with weekly ticks) instead of reading like a
  // brand-new finding. openedAt is the date the alert first fired (for an
  // aggregated email_delay_high it is the earliest confirmed day still in window).
  var AGE_MAX_DAYS = 28; // bar saturates at 4 weeks
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parseDay(s) {
    if (!s) return null;
    var m = String(s).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m)) return null;
    var d = new Date(m + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function fmtDay(d) { return MONTHS[d.getMonth()] + " " + d.getDate(); }
  // Number of whole days an alert has been open as of the current run.
  function alertAgeDays(openedAt, runStr) {
    var o = parseDay(openedAt), now = parseDay(runStr);
    if (!o || !now) return null;
    return daysBetween(o, now);
  }
  function ageGraph(openedAt, runStr, sev) {
    var o = parseDay(openedAt), now = parseDay(runStr);
    if (!o || !now) return "";
    var days = daysBetween(o, now);
    if (days < 1) return "";
    var W = 70, H = 16, pad = 1, inner = W - pad * 2;
    var frac = Math.min(days, AGE_MAX_DAYS) / AGE_MAX_DAYS;
    var fillW = Math.max(3, frac * inner);
    var cls = sev === "danger" ? "age--danger" : sev === "warning" ? "age--warning" : "age--info";
    var ticks = "";
    for (var w = 7; w < AGE_MAX_DAYS; w += 7) {
      var x = pad + (w / AGE_MAX_DAYS) * inner;
      ticks += '<line class="agebar__tick" x1="' + x.toFixed(1) + '" y1="3" x2="' + x.toFixed(1) + '" y2="13"/>';
    }
    var weeks = Math.floor(days / 7);
    var label = days >= AGE_MAX_DAYS ? AGE_MAX_DAYS + "d+" : (weeks >= 2 ? weeks + "w" : days + "d");
    var title = "Open since " + fmtDay(o) + " \u00B7 " + days + " day" + (days > 1 ? "s" : "") +
      " (already present at previous run" + (days >= 14 ? "s" : "") + ")";
    return (
      '<span class="age ' + cls + '" title="' + esc(title) + '">' +
        '<svg class="agebar" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">' +
          '<line class="agebar__track" x1="' + pad + '" y1="8" x2="' + (W - pad) + '" y2="8"/>' +
          ticks +
          '<rect class="agebar__fill" x="' + pad + '" y="5" width="' + fillW.toFixed(1) + '" height="6" rx="3"/>' +
        "</svg>" +
        '<span class="age__txt">' + esc(label) + "</span>" +
      "</span>"
    );
  }
  function newChip() {
    return '<span class="age age--new" title="New this run \u2014 not present at the previous run">\uD83C\uDD95 new</span>';
  }
  // Age affordance for one alert: a duration bar once it has survived a run, the
  // "new" chip on its first, and an empty slot when `openedAt` is unusable — the
  // slot is always emitted so rows stay aligned.
  function ageAffordance(a, runStr) {
    var openedAt = a.openedAt || a.opened || null;
    if (openedAt) {
      var days = alertAgeDays(openedAt, runStr);
      if (days != null) return days >= 1 ? ageGraph(openedAt, runStr, a.severity || "info") : newChip();
    }
    return '<span class="age"></span>';
  }
  // --- stats -----------------------------------------------------------------
  function computeStats(data) {
    var clients = data.clients || [];
    var projects = 0;
    var inAlert = 0;
    var open = 0;
    var muted = 0;
    clients.forEach(function (c) {
      (c.projects || []).forEach(function (p) {
        projects++;
        var pa = projAlerts(p);
        open += pa.count;
        muted += pa.mutedCount;
        if (pa.count > 0) inAlert++;
      });
    });
    var s = data.stats || {};
    return {
      clients: s.clients != null ? s.clients : clients.length,
      projects: s.projects != null ? s.projects : projects,
      projectsInAlert: s.projectsInAlert != null ? s.projectsInAlert : inAlert,
      openAlerts: s.openAlerts != null ? s.openAlerts : open,
      resolutions: s.resolutions != null ? s.resolutions : 0,
      muted: s.muted != null ? s.muted : muted,
    };
  }

  // --- render ----------------------------------------------------------------
  function render(root) {
    var data = APP.data;
    var route = APP.route = parseRoute();
    root.innerHTML = "";

    var headerSpark = "";
    if (data.history && data.history.length > 1) {
      headerSpark =
        '<div class="spark"><span class="spark__label">Open alerts trend</span>' +
        lineSparkline(data.history.map(function (h) { return h.openAlerts || 0; })) +
        "</div>";
    }

    var badge = APP.serverMode
      ? '<span class="srvbadge srvbadge--live" title="Local server running — edits apply directly">\u25CF Live editing</span>'
      : '<span class="srvbadge srvbadge--ro" title="No local server — edits are copied as prompts. Run serve.command to edit directly.">\u25CB Read-only</span>';

    var activeTab = route.name === "setup" ? "setup" : "monitor";
    var header = el(
      '<header class="header">' +
        '<div class="header__top">' +
          "<div>" +
            '<h1 class="title"><a class="title__link" href="#/"><span class="logo">\uD83D\uDEF0\uFE0F</span>Airship KPI Monitor</a></h1>' +
            '<p class="subtitle">Last run: <strong>' + esc(data.generatedAt || "n/a") + "</strong>" +
              (windowText(data.window) ? '<span class="sep">\u2022</span>Window ' + esc(windowText(data.window)) : "") +
            "</p>" +
          "</div>" +
          '<div class="header__right">' +
            headerSpark +
            badge +
            '<button class="btn" id="themeBtn" title="Toggle theme">\u25D0 Theme</button>' +
          "</div>" +
        "</div>" +
        '<nav class="nav">' +
          '<a class="nav__tab" href="#/" data-route="monitor" aria-current="' + (activeTab === "monitor" ? "true" : "false") + '">Monitor</a>' +
          '<a class="nav__tab" href="#/setup" data-route="setup" aria-current="' + (activeTab === "setup" ? "true" : "false") + '">Setup</a>' +
        "</nav>" +
      "</header>"
    );
    root.appendChild(header);

    var view = el('<div id="view" class="view"></div>');
    root.appendChild(view);

    if (route.name === "setup") {
      renderSetup(view, data);
    } else if (route.name === "project") {
      var found = findProject(data, route.project);
      if (found) renderProject(view, data, found.client, found.project);
      else renderMissingProject(view, route.project);
    } else {
      renderMonitor(view, data);
    }

    root.appendChild(
      el(
        '<footer class="foot">Local snapshot rewritten on each agent run (this page cannot refresh on its own). ' +
          "The live, shareable source is each project\u2019s Slack KPI canvas, linked per project. " +
          "No secrets are stored in this dashboard.</footer>"
      )
    );

    wireUp(root, data);
  }

  function rerender() { render(document.getElementById("app")); }

  // Programmatic navigation used by the Setup CRUD (keeps the user on Setup after a save).
  function setActiveView(root, view) { navTo(view === "setup" ? "#/setup" : "#/"); }

  function renderMissingProject(root, name) {
    root.appendChild(breadcrumb(esc(name || "Unknown project")));
    root.appendChild(
      el(
        '<div class="empty">Project <strong>' + esc(name || "") + "</strong> is not in the current snapshot. " +
          'It may have been renamed or removed. <a href="#/">Back to Monitor</a>.</div>'
      )
    );
  }

  function breadcrumb(leaf) {
    return el(
      '<nav class="crumbs" aria-label="Breadcrumb">' +
        '<a href="#/">Monitor</a>' +
        '<span class="crumbs__sep">\u203A</span>' +
        '<span class="crumbs__leaf">' + leaf + "</span>" +
      "</nav>"
    );
  }

  function renderMonitor(root, data) {
    if (data.isSample || window.__KPI_DATA_FILE_MISSING) {
      root.appendChild(
        el(
          '<div class="banner">\u26A0\uFE0F <span>Showing <strong>sample data</strong>. Run the skill once to generate the local ' +
            "<code>dashboard-data.js</code> with your real projects.</span>" +
            '<button class="btn btn--primary banner__btn" id="runPromptBtn" type="button">Copy run prompt</button></div>'
        )
      );
    }

    var st = computeStats(data);
    root.appendChild(
      el(
        '<section class="stats">' +
          stat(st.clients, "Clients") +
          stat(st.projects, "Projects monitored") +
          stat(st.projectsInAlert, "Projects in alert", st.projectsInAlert > 0 ? "warning" : "") +
          stat(st.openAlerts, "Open alerts", st.openAlerts > 0 ? "danger" : "") +
          stat(st.resolutions, "Resolutions today", st.resolutions > 0 ? "success" : "") +
          (st.muted > 0 ? stat(st.muted, "Alerts off", "muted") : "") +
        "</section>"
      )
    );


    var toolbar = el(
      '<div class="toolbar">' +
        '<div class="search"><span class="search__icon">\uD83D\uDD0D</span>' +
          '<input id="q" type="search" placeholder="Filter projects, clients, channels\u2026" autocomplete="off" /></div>' +
        '<div class="filters">' +
          '<button class="chip" data-sev="danger" aria-pressed="false"><span class="dot dot--danger"></span>Critical</button>' +
          '<button class="chip" data-sev="warning" aria-pressed="false"><span class="dot dot--warning"></span>Watch</button>' +
          '<button class="chip" data-sev="info" aria-pressed="false"><span class="dot dot--info"></span>Info</button>' +
        "</div>" +
        '<button class="btn" id="toggleAll">Collapse all</button>' +
      "</div>"
    );
    root.appendChild(toolbar);

    var cardsWrap = el('<div id="cards"></div>');
    root.appendChild(cardsWrap);

    var groups = buildChannelGroups(data);
    groups.sort(function (a, b) {
      var aAlerts = a.items.reduce(function (s, it) { return s + projAlerts(it.project).count; }, 0);
      var bAlerts = b.items.reduce(function (s, it) { return s + projAlerts(it.project).count; }, 0);
      return bAlerts - aAlerts || String(a.clients[0] && a.clients[0].name || a.channel).localeCompare(String(b.clients[0] && b.clients[0].name || b.channel));
    });
    groups.forEach(function (g) {
      cardsWrap.appendChild(channelGroupCard(data, g));
    });

    if (data.resolvedRecently && data.resolvedRecently.length) {
      root.appendChild(resolvedSection(data.resolvedRecently));
    }
  }

  // Log of alerts that cleared the resolve hysteresis recently (Step 9). No Slack
  // post fires for these any more — the dashboard is where recoveries are tracked.
  function resolvedSection(list) {
    var rows = list
      .map(function (r) {
        return (
          '<li class="resolved">' +
            '<span class="resolved__mark">\u2713</span>' +
            '<code class="alert__key">' + esc(r.key) + "</code>" +
            (r.project ? '<span class="resolved__proj">' + esc(r.project) + "</span>" : "") +
            (r.resolvedAt ? '<span class="resolved__when">' + esc(r.resolvedAt) + "</span>" : "") +
            (r.cause ? '<span class="alert__cause">' + esc(r.cause) + "</span>" : "") +
          "</li>"
        );
      })
      .join("");
    return el(
      '<section class="card resolvedcard">' +
        '<div class="card__head" style="cursor:default">' +
          '<span class="card__name">\u2705 Recently resolved</span>' +
          '<span class="card__meta">' + list.length + " cleared</span>" +
        "</div>" +
        '<div class="card__body"><ul class="resolvedlist">' + rows + "</ul></div>" +
      "</section>"
    );
  }

  function stat(value, label, tone) {
    return (
      '<div class="stat' + (tone ? " stat--" + tone : "") + '">' +
        '<div class="stat__value">' + esc(value) + "</div>" +
        '<div class="stat__label">' + esc(label) + "</div>" +
      "</div>"
    );
  }

  function thresholdUnit(t) {
    var it = t && t.key ? catalogItem(t.key) : null;
    if (it && it.unit) return it.unit;
    return "";
  }
  // Short "worst headroom" chip for the fleet list — the KPI closest to breaching.
  function headroomChip(p) {
    var wh = worstHeadroomMetric(p);
    if (!wh) return "";
    var t = wh.threshold;
    var u = thresholdUnit(t);
    var us = u === "pts" ? " pts" : u === "%" ? "%" : "";
    if (t.breaching) {
      return '<span class="hchip hchip--danger" title="' + esc(wh.label) + ' is breaching its threshold">breaching: ' + esc(wh.label) + "</span>";
    }
    var tone = t.headroom <= Math.abs(Number(t.value)) * 0.25 ? "warn" : "ok";
    return '<span class="hchip hchip--' + tone + '" title="Closest KPI to its alert threshold">worst headroom: ' +
      fmt1(t.headroom) + us + " \u00B7 " + esc(wh.label) + "</span>";
  }

  // A project rendered as a compact, clickable fleet-list row (recap). Full depth
  // lives on the deep project page (#/project/<name>), opened by clicking the row.
  function projectBlock(data, c, p) {
    var pa = projAlerts(p);
    var cands = (p.candidatesList || []).filter(function (a) { return a && a.key; });

    // One dot per KPI actually in alert, each named on hover — a single "3 Critical"
    // pill said how many but never which, so the row could not be triaged without
    // opening it. Muted KPIs are deliberately absent: a guard someone turned off is
    // a setting, not a state of the project, and it has no business competing for
    // attention here.
    var alerting = alertingMetrics(p);
    // Severity follows the dots, so a row can never be painted red while showing
    // no alert. projAlerts() only sees the snapshot's own `muted` flag, and it
    // counted candidates the confirmation gate had not accepted.
    var sev = alerting.length
      ? (alerting.some(function (a) { return a.sev === "danger"; }) ? "danger" : "warning")
      : null;
    var badges = "";
    if (alerting.length) {
      badges += '<span class="pdots" title="' + esc(alerting.map(function (a) { return a.metric.label || a.metric.key; }).join(", ")) + '">' +
        alerting.slice(0, 8).map(function (a) {
          return '<span class="dot dot--' + a.sev + '" title="' + esc(a.metric.label || a.metric.key) + '"></span>';
        }).join("") +
        (alerting.length > 8 ? '<span class="pdots__more">+' + (alerting.length - 8) + "</span>" : "") +
      "</span>";
      badges += '<span class="pill ' + SEV[sev || "warning"].pill + '">' + alerting.length +
        (alerting.length > 1 ? " KPIs in alert" : " KPI in alert") + "</span>";
    } else if (!cands.length) {
      badges += '<span class="pill pill--ok">\u2713 OK</span>';
    }
    if (cands.length > 0) {
      badges += '<span class="pill pill--cand">\uD83D\uDD0E ' + cands.length + " watching</span>";
    }

    // Representative micro-trend: worst-headroom metric series, else alert-count bars.
    var wh = worstHeadroomMetric(p);
    var spark = "";
    if (wh && wh.series && wh.series.length >= 2) {
      spark = '<span class="proj__sparklbl">' + esc(wh.label) + "</span>" + lineSparkline(wh.series.map(function (s) { return s.v; }), 96, 22);
    } else {
      var bs = barSparkline(p.alertHistory, sev, 84, 20);
      if (bs) spark = '<span class="proj__sparklbl">Alerts</span>' + bs;
    }

    var canvas = p.canvasId
      ? '<a class="linkbtn" data-nonav href="' + esc(canvasLink(data, p.canvasId)) + '">\uD83D\uDCCA Canvas</a>'
      : "";

    var mutedKeys = (pa.list || []).filter(function (a) { return a.muted; }).map(function (a) { return a.key; }).join(" ");
    var candKeys = cands.map(function (a) { return a.key; }).join(" ");
    var hay = (p.name + " " + (c.name || "") + " " + (p.channel || "") + " " +
      (Array.isArray(p.trend) ? p.trend.join(" ") : p.trend || "") + " " + mutedKeys + " " + candKeys).toLowerCase();

    return (
      '<article class="proj proj--link' + (sev ? " proj--" + sev : "") + '" data-hay="' + esc(hay) + '" data-sev="' + esc(sev || "") +
        '" data-project="' + esc(p.name) + '" role="link" tabindex="0" aria-label="Open details for ' + esc(p.name) + '">' +
        '<div class="proj__row">' +
          '<div class="proj__id">' +
            '<span class="proj__name">' + esc(p.name) + "</span>" +
            '<a class="chan" data-nonav href="' + esc(channelLink(data, p.channel)) + '">#' + esc(p.channel) + "</a>" +
          "</div>" +
          '<span class="proj__badges">' + badges + "</span>" +
          headroomChip(p) +
          '<span class="proj__spacer"></span>' +
          (spark ? '<span class="proj__spark">' + spark + "</span>" : "") +
          '<span class="proj__when" title="Last run">\uD83D\uDD52 ' + esc(p.lastRun || "\u2014") + "</span>" +
          canvas +
          '<span class="proj__open">Open details \u2192</span>' +
        "</div>" +
      "</article>"
    );
  }

  // Group all projects by their Slack channel, merging clients that share a channel
  // into a single fleet-list card (e.g. Client A + Client B + Client C → cs_fr_shared).
  function buildChannelGroups(data) {
    var map = {}, order = [];
    (data.clients || []).forEach(function (c) {
      (c.projects || []).forEach(function (p) {
        var ch = p.channel || "_no_channel_";
        if (!map[ch]) { map[ch] = { channel: ch, clients: [], items: [] }; order.push(ch); }
        var g = map[ch];
        if (!g.clients.some(function (cc) { return cc.name === c.name; })) g.clients.push(c);
        g.items.push({ client: c, project: p });
      });
    });
    return order.map(function (ch) { return map[ch]; });
  }

  // Fleet-list card for a channel group (1-N clients, 1-N projects sharing a Slack channel).
  function channelGroupCard(data, g) {
    var items = g.items.slice().sort(function (a, b) {
      return projAlerts(b.project).count - projAlerts(a.project).count ||
        String(a.project.name).localeCompare(String(b.project.name));
    });
    var nAlerts = items.reduce(function (s, it) { return s + projAlerts(it.project).count; }, 0);
    var nCands  = items.reduce(function (s, it) { return s + (it.project.candidatesList || []).length; }, 0);
    var nP = items.length;

    var metaParts = [nP + " project" + (nP > 1 ? "s" : "")];
    if (nAlerts > 0) metaParts.unshift(nAlerts + " open alert" + (nAlerts > 1 ? "s" : ""));
    else if (nCands > 0) metaParts.unshift(nCands + " watching");
    else metaParts.push("stable");

    var clientNames = g.clients.map(function (c) { return c.name; }).join(" \u00B7 ");
    var channelTag = g.channel && g.channel !== "_no_channel_"
      ? '<a class="chan card__chan" data-nonav href="' + esc(channelLink(data, g.channel)) + '">#' + esc(g.channel) + "</a>"
      : "";
    var haystack = (clientNames + " " + g.channel + " " +
      items.map(function (it) { return it.project.name; }).join(" ")).toLowerCase();

    var blocks = items.map(function (it) { return projectBlock(data, it.client, it.project); }).join("");

    return el(
      '<section class="card" data-client="' + esc(haystack) + '">' +
        '<button class="card__head" type="button">' +
          '<span class="card__caret">\u25BC</span>' +
          '<span class="card__name">' + esc(clientNames) + "</span>" +
          channelTag +
          '<span class="card__meta">' + esc(metaParts.join(" \u00B7 ")) + "</span>" +
        "</button>" +
        '<div class="card__body">' + blocks + "</div>" +
      "</section>"
    );
  }

  // --- deep project page (#/project/<name>) ----------------------------------
  function renderProject(root, data, c, p) {
    var pa = projAlerts(p);
    var cands = (p.candidatesList || []).filter(function (a) { return a && a.key; });
    // Confirmed alerts only — the header pill, the banner and the fleet dots all
    // read from this one list so they cannot disagree.
    var alerting = alertingMetrics(p);
    var sev = alerting.length
      ? (alerting.some(function (a) { return a.sev === "danger"; }) ? "danger" : "warning")
      : null;
    var resolved = (data.resolvedRecently || []).filter(function (r) {
      return String(r.project || "").trim().toLowerCase() === String(p.name).trim().toLowerCase();
    });

    root.appendChild(breadcrumb(esc(p.name)));

    // Header
    var sevPill = alerting.length && sev
      ? '<span class="pill ' + SEV[sev].pill + '">' + alerting.length + " " + SEV[sev].label + "</span>"
      : (cands.length ? '<span class="pill pill--cand">\uD83D\uDD0E ' + cands.length + " watching</span>" : '<span class="pill pill--ok">\u2713 Stable</span>');
    var ind = projIndustry(p);
    var indBtn = '<button class="linkbtn indbtn" type="button" data-project="' + esc(p.name) + '" data-industry="' + esc(ind) +
      '" title="Industry vertical for benchmark comparison">\uD83C\uDFF7\uFE0F ' + (ind ? esc(verticalLabel(ind)) : "Set industry") + "</button>";
    var canvas = p.canvasId ? '<a class="linkbtn" href="' + esc(canvasLink(data, p.canvasId)) + '">\uD83D\uDCCA Canvas</a>' : "";
    root.appendChild(
      el(
        '<section class="phead' + (sev ? " phead--" + sev : "") + '">' +
          '<div class="phead__main">' +
            '<h2 class="phead__name">' + esc(p.name) + " " + sevPill + "</h2>" +
            '<div class="phead__sub">' +
              '<a class="chan" href="' + esc(channelLink(data, p.channel)) + '">#' + esc(p.channel) + "</a>" +
              '<span class="phead__client">' + esc(c.name || "") + "</span>" +
              '<span class="phead__when">\uD83D\uDD52 ' + esc(p.lastRun || "\u2014") + "</span>" +
            "</div>" +
          "</div>" +
          '<div class="phead__actions">' + indBtn + canvas + "</div>" +
        "</section>"
      )
    );

    // file:// onboarding banner — editing needs the local server.
    if (!APP.serverMode) {
      root.appendChild(
        el(
          '<div class="banner banner--info">\u2139\uFE0F <span>Read-only view. To edit thresholds, apply suggestions and mute alerts here, ' +
            "start the local server: <code>uv run --with ruamel.yaml serve.py</code> (or double-click <code>serve.command</code>) and open " +
            "<code>http://127.0.0.1:8787</code>. Without it, actions become prompts you paste into Cursor chat.</span></div>"
        )
      );
    }

    // What needs attention, named. The banner used to lead with "breaching" and a
    // set of counts, which said how many things were wrong but never which — the
    // reader still had to hunt down the page. Lead with the KPIs themselves, each
    // one a link to its card; keep the counts as a quiet second line.
    var wh = worstHeadroomMetric(p);
    var rows = alerting.map(function (a) {
      var m = a.metric;
      var cause = a.state.active[0] || {};
      // How long this has been open, as the documented age bar rather than a bare
      // date. The exact openedAt stays in its tooltip.
      var since = cause.openedAt
        ? '<span class="alertboard__since">' + ageAffordance(cause, data.generatedAt) + "</span>"
        : "";
      var why = cause.cause || cause.note || (m.threshold && m.threshold.breaching
        ? "past its " + esc(String(m.threshold.kind || "threshold")) + " of " + fmtPrec(m.threshold.value) : "");
      // A button, not a link: the router owns the hash (`#/project/<name>`), so an
      // `href="#kpi-…"` parsed as an unknown route and bounced back to the fleet
      // list. Scrolling to a card on the page we are already on is an in-page
      // action, not navigation.
      return '<button type="button" class="alertboard__row alertboard__row--' + a.sev +
        '" data-nonav data-goto="' + esc(metricAnchor(m)) + '">' +
        '<span class="dot dot--' + a.sev + '"></span>' +
        '<span class="alertboard__kpi">' + esc(m.label || m.key) + "</span>" +
        '<span class="alertboard__why">' + esc(String(why || "").slice(0, 140)) + "</span>" +
        since +
      "</button>";
    }).join("");

    var counts = '<div class="alertboard__counts">' +
      '<span class="alertboard__count' + (alerting.length ? " is-hot" : "") + '">' + alerting.length + " in alert</span>" +
      '<span class="alertboard__count">' + cands.length + " watching</span>" +
      '<span class="alertboard__count">' + resolved.length + " resolved recently</span>" +
      (wh ? '<span class="alertboard__count">worst headroom \u00B7 ' + esc(wh.label) + "</span>" : "") +
    "</div>";

    root.appendChild(
      el(
        '<section class="alertboard' + (alerting.length ? " alertboard--hot" : " alertboard--clear") + '">' +
          '<div class="alertboard__head">' +
            '<h3 class="alertboard__title">' +
              (alerting.length ? "Needs attention" : "\u2713 No open alerts") + "</h3>" +
            counts +
          "</div>" +
          (rows ? '<div class="alertboard__list">' + rows + "</div>" : "") +
        "</section>"
      )
    );

    // KPI panels by channel. The SparkPost drill-down is folded INTO the email
    // panel rather than sitting in a section of its own — see kpiPanels.
    root.appendChild(kpiPanels(p));

    // Thresholds & suggestions
    root.appendChild(thresholdsPanel(p));
  }

  // ---------------------------------------------------------------------------
  // Email deliverability (SparkPost, SKILL.md Step 3e)
  //
  // Airship reports email totals but not WHERE mail lands or WHY it failed. This
  // panel adds the missing axis: per-mailbox-provider rates plus the reason
  // strings remote servers actually returned. It is the diagnosis surface — the
  // Slack canvas deliberately stays synthetic and points here.
  // ---------------------------------------------------------------------------

  // Thresholds for colouring a rate cell. Deliberately stricter than the alerting
  // thresholds: this is a reading aid for a human scanning a table, not an alert.
  var DLV_BANDS = {
    delivery: { good: 99, warn: 95, higherIsBetter: true },
    open: { good: 25, warn: 10, higherIsBetter: true },
    delay: { good: 2, warn: 10, higherIsBetter: false },
    bounce: { good: 1, warn: 2, higherIsBetter: false },
    spam: { good: 0.02, warn: 0.1, higherIsBetter: false },
    ctor: { good: 10, warn: 3, higherIsBetter: true },
  };

  // ---------------------------------------------------------------------------
  // Per-sending-domain email breakdown
  //
  // The project rollup is recombined from raw counts, which is correct but hides
  // the small domain in trouble. This table restores it: one row per declared
  // domain with its own score, its own rates, and how much of its volume rides
  // shared IPs — a client on a shared pool inherits its neighbours' reputation
  // and no figure of its own will ever explain why.
  // ---------------------------------------------------------------------------
  function scoreTone(s) {
    if (s === null || s === undefined) return "";
    return s >= 90 ? "ok" : s >= 60 ? "warn" : "bad";
  }

  // The sender score measures ACCEPTANCE — whether the receiver took the mail.
  // It is blind to PLACEMENT, i.e. inbox vs spam folder, which no API reports
  // without the paid add-on. Client Alpha is why the two are shown side by side: 100/100
  // on acceptance while it lost 21.8 points of open rate with its IP suspended.
  var RISK_LABEL = { high: "at risk", watch: "watch", none: "clear", na: "na" };
  function riskChip(risk) {
    if (!risk || !risk.level) return '<span class="dlv-risk dlv-risk--na">na</span>';
    var reasons = (risk.reasons || []).join("\n");
    return '<span class="dlv-risk dlv-risk--' + risk.level + '"' +
      (reasons ? ' title="' + esc(reasons) + '"' : "") + ">" +
      (RISK_LABEL[risk.level] || risk.level) + "</span>";
  }

  function decorateEmailDomains(sec, p) {
    var doms = p.emailDomains || [];
    if (!doms.length) return;
    var sum = p.emailSummary || {};

    var rows = doms.map(function (d) {
      var r = d.rates || {};
      var exp = d.ipExposure || {};
      if (!d.active) {
        return '<tr class="dlv-idle"><td class="dlv-prov">' + esc(d.domain) + "</td>" +
          '<td colspan="8">configured on SparkPost, no traffic in the window \u2014 <code>na</code>, not healthy</td></tr>';
      }
      // A shared IP is not automatically worse: Client Delta's shared IPs deliver at ~97%
      // while its own dedicated IP delivers at 35.8%. The cell states exposure,
      // it does not pass judgement.
      var shared = (d.sendingIps || []).filter(function (i) { return i.shared; });
      var ipCell = exp.shared_ip_count
        ? '<span class="dlv-ip dlv-ip--shared" title="' +
            esc(shared.map(function (i) {
              return i.ip + " \u2192 " + (i.coTenants || []).slice(0, 8).join(", ");
            }).join(" | ")) + '">' + fmt1(exp.shared_volume_pct) + "% shared \u00B7 \u2264" +
            exp.worst_co_tenant_count + " co-tenants</span>"
        : '<span class="dlv-ip">dedicated \u00B7 ' + (exp.ip_count || 0) + " IP</span>";
      return "<tr>" +
        '<td class="dlv-prov">' + esc(d.domain) + "</td>" +
        '<td class="dlv-num dlv-num--plain">' + esc(fmtCount(r.injected)) + "</td>" +
        '<td class="dlv-num dlv-score dlv-num--' + scoreTone(d.senderScore) + '">' +
          (d.senderScore == null ? "na" : d.senderScore) + "</td>" +
        "<td>" + riskChip(d.placementRisk) + "</td>" +
        dlvCell("delivery", r.delivery_rate, 2) +
        dlvCell("bounce", r.bounce_rate, 2) +
        dlvCell("delay", r.delay_rate, 2) +
        dlvCell("spam", r.spam_complaint_rate, 3) +
        dlvCell("open", r.open_rate, 1) +
        "<td>" + ipCell + "</td>" +
      "</tr>";
    }).join("");

    var lead =
      "<strong>" + doms.length + " sending domain" + (doms.length > 1 ? "s" : "") + "</strong>" +
      (sum.activeDomainCount != null && sum.activeDomainCount !== doms.length
        ? " \u00B7 " + sum.activeDomainCount + " active in the window" : "") +
      (sum.senderScore != null
        ? ' \u00B7 project sender score <strong class="dlv-num--' + scoreTone(sum.senderScore) + '">' +
          sum.senderScore + "/100</strong> (" + esc(sum.senderGrade || "") + ")" : "") +
      (sum.sharedIpVolumePct ? " \u00B7 " + fmt1(sum.sharedIpVolumePct) + "% of volume on shared IPs" : "");

    var risk = sum.placementRisk || {};
    var riskNote = risk.level && risk.level !== "none" && risk.level !== "na"
      ? '<p class="dlv-riskline dlv-riskline--' + risk.level + '">' +
          "<strong>Placement " + esc(RISK_LABEL[risk.level] || risk.level) + "</strong>" +
          (risk.domain ? " on <code>" + esc(risk.domain) + "</code>" : "") + " \u2014 " +
          esc((risk.reasons || []).join(" ")) + "</p>"
      : "";

    sec.appendChild(el(
      '<section class="panel dlv-panel dlv-panel--domains">' +
        "<h3>By sending domain</h3>" +
        '<p class="dlv-lead">' + lead + "</p>" +
        riskNote +
        '<p class="dlv-hint">Project rates are recombined from raw counts, never averaged across ' +
        "domains \u2014 a domain carrying 2% of the volume cannot move the headline, which is exactly " +
        "why it needs its own row. <strong>Score</strong> grades acceptance (was the mail taken); " +
        "<strong>Placement</strong> flags the inbox-vs-spam risk the score cannot see. " +
        "Source: SparkPost Metrics API.</p>" +
        '<div class="dlv-tblwrap"><table class="dlv-tbl">' +
          "<thead><tr><th>Domain</th><th>Injected</th><th>Score</th><th>Placement</th><th>Deliv.</th>" +
          "<th>Bounce</th><th>Delay</th><th>Spam</th><th>Open</th><th>IP exposure</th></tr></thead>" +
          "<tbody>" + rows + "</tbody></table></div>" +
      "</section>"
    ));

    // One drill-down per domain, collapsed. Open the first by default: a page
    // where everything is collapsed reads as though there were nothing to see.
    doms.forEach(function (d, i) {
      if (!d.active || !d.deliverability) return;
      sec.appendChild(domainDrilldown(d, i === 0));
    });
  }

  // Bounce composition, engagement quality and the verbatim MTA strings, for ONE
  // sending domain. Split by axis because each answers a different question:
  // provider = who is judging us, receiving domain = which inbox, reason = why.
  function domainDrilldown(d, open) {
    var dv = d.deliverability;
    var r = d.rates || {};

    var findings = (dv.findings || []).map(function (f) {
      var sev = /^(danger|warning|success)$/.test(f.severity) ? f.severity : "info";
      return '<div class="dlv-find dlv-find--' + sev + '">' +
        '<div class="dlv-find__title">' + esc(f.title) + "</div>" +
        (f.detail ? '<div class="dlv-find__body">' + esc(f.detail) + "</div>" : "") + "</div>";
    }).join("");

    // Bounce composition deserves its own line: 0.93% total means one thing when
    // it is invalid addresses and another when it is full mailboxes.
    var comp = '<p class="dlv-hint">Bounce composition \u2014 <strong>' + dlvPct(r.bounce_rate, 2) +
      "</strong> total: " + dlvPct(r.hard_bounce_rate, 3) + " hard (invalid address, list quality) \u00B7 " +
      dlvPct(r.soft_bounce_rate, 3) + " soft (temporary, usually a full mailbox) \u00B7 " +
      dlvPct(r.block_bounce_rate, 3) + " block (refused on reputation) \u00B7 " +
      dlvPct(r.admin_bounce_rate, 3) + " admin. " +
      "Engagement \u2014 " + dlvPct(r.open_rate, 1) + " open, " + dlvPct(r.click_rate, 2) +
      " click, <strong>" + dlvPct(r.ctor, 2) + " click-to-open</strong> (the signal Apple MPP cannot inflate). " +
      "Delivery \u2014 " + dlvPct(r.first_attempt_delivery_rate, 1) + " landed on the first attempt, " +
      (r.delay_retries_per_delivered == null ? "\u2014" : r.delay_retries_per_delivered) +
      " retries per delivered message.</p>";

    function sliceTable(title, rows, note) {
      if (!rows || !rows.length) return "";
      var body = rows.slice(0, 12).map(function (x) {
        return "<tr>" +
          '<td class="dlv-prov">' + esc(x.name || "\u2014") + "</td>" +
          '<td class="dlv-share">' + dlvBar(x.share) + '<span class="dlv-share__txt">' + dlvPct(x.share, 1) + "</span></td>" +
          '<td class="dlv-num dlv-num--plain">' + esc(fmtCount(x.injected)) + "</td>" +
          dlvCell("delivery", x.deliveryRate, 2) +
          dlvCell("bounce", x.bounceRate, 2) +
          dlvCell("bounce", x.hardBounceRate, 3) +
          dlvCell("delay", x.delayRate, 2) +
          dlvCell("spam", x.spamRate, 3) +
          dlvCell("open", x.openRate, 1) +
          dlvCell("ctor", x.ctor, 2) +
        "</tr>";
      }).join("");
      return '<section class="panel dlv-panel"><h3>' + esc(title) + "</h3>" +
        (note ? '<p class="dlv-hint">' + note + "</p>" : "") +
        '<div class="dlv-tblwrap"><table class="dlv-tbl"><thead><tr>' +
        "<th>" + (title.indexOf("provider") > -1 ? "Provider" : "Receiving domain") + "</th><th>Share</th>" +
        "<th>Volume</th><th>Deliv.</th><th>Bounce</th><th>Hard</th><th>Delay</th><th>Spam</th>" +
        "<th>Open</th><th>CTOR</th></tr></thead><tbody>" + body + "</tbody></table></div></section>";
    }

    function reasonTable(title, rows, note) {
      if (!rows || !rows.length) return "";
      // Delay rows carry our own classification (`label`), bounce rows carry
      // SparkPost's (`className`). Either way the column answers "what kind".
      var hasClass = rows.some(function (x) { return x.className || x.label; });
      var body = rows.slice(0, 10).map(function (x) {
        var cls = x.className || x.label;
        return "<tr>" +
          '<td class="dlv-prov">' + esc(x.domain || "\u2014") + "</td>" +
          '<td class="dlv-num dlv-num--plain">' + esc(fmtCount(x.count)) + "</td>" +
          (hasClass
            ? '<td class="dlv-bclass">' + (cls
                ? '<span class="dlv-dcls dlv-dcls--' + (x.severity || "info") + '">' + esc(cls) + "</span>"
                : "\u2014") + "</td>"
            : "") +
          "<td>" + dlvReason(x.reason) + "</td></tr>";
      }).join("");
      return '<section class="panel dlv-panel"><h3>' + esc(title) + "</h3>" +
        (note ? '<p class="dlv-hint">' + note + "</p>" : "") +
        '<div class="dlv-tblwrap"><table class="dlv-tbl"><thead><tr><th>Receiving domain</th>' +
        "<th>Count</th>" + (hasClass ? '<th class="dlv-bclass">Class</th>' : "") +
        "<th>Reason returned by the remote server</th></tr></thead><tbody>" +
        body + "</tbody></table></div></section>";
    }

    // A single delay rate hides three unrelated problems. Splitting the
    // deferrals by what the receiver actually said is what makes it readable:
    // Client Alpha reads 82% "sending IP suspended", Client Bravo 65% "mailbox full".
    var defCls = (dv.deferralClasses || []).filter(function (c) { return c.count; });
    var deferralPanel = defCls.length
      ? '<section class="panel dlv-panel"><h3>What the deferrals actually were</h3>' +
        '<p class="dlv-hint">Every deferral string grouped by cause. A full mailbox costs retries and ' +
        "nothing else; a reputation string or a suspended IP is a different problem with a different fix. " +
        "The delay rate on its own cannot tell them apart.</p>" +
        '<div class="dlv-tblwrap"><table class="dlv-tbl"><thead><tr><th>Cause</th><th>Share</th>' +
        "<th>Messages</th><th>Receivers</th><th>What it means</th></tr></thead><tbody>" +
        defCls.map(function (c) {
          return "<tr>" +
            '<td class="dlv-prov"><span class="dlv-dcls dlv-dcls--' + (c.severity || "info") + '">' +
              esc(c.label) + "</span></td>" +
            '<td class="dlv-share">' + dlvBar(c.share) + '<span class="dlv-share__txt">' +
              dlvPct(c.share, 1) + "</span></td>" +
            '<td class="dlv-num dlv-num--plain">' + esc(fmtCount(c.count)) + "</td>" +
            '<td class="dlv-cls">' + esc((c.domains || []).slice(0, 4).join(", ")) + "</td>" +
            '<td class="dlv-cls">' + esc(c.meaning || "") + "</td></tr>";
        }).join("") + "</tbody></table></div></section>"
      : "";

    var classes = (dv.bounceClasses || []).filter(function (c) { return c.count; });
    var classTable = classes.length
      ? '<section class="panel dlv-panel"><h3>Bounce classification</h3>' +
        '<p class="dlv-hint">SparkPost\u2019s own classification. Hard means the address does not exist ' +
        "(clean the list); Soft is temporary (wait, then age the address out); Block means the receiver " +
        "refused on policy (a reputation problem no list change fixes).</p>" +
        '<div class="dlv-tblwrap"><table class="dlv-tbl"><thead><tr><th>Class</th><th>Category</th>' +
        "<th>Count</th><th>Share</th><th>What it means</th></tr></thead><tbody>" +
        classes.slice(0, 10).map(function (c) {
          return "<tr>" +
            '<td class="dlv-prov">' + esc(c.name || "\u2014") + "</td>" +
            "<td>" + esc(c.category || "\u2014") + "</td>" +
            '<td class="dlv-num dlv-num--plain">' + esc(fmtCount(c.count)) + "</td>" +
            '<td class="dlv-num dlv-num--plain">' + dlvPct(c.share, 1) + "</td>" +
            '<td class="dlv-cls">' + esc(c.description || "") + "</td></tr>";
        }).join("") + "</tbody></table></div></section>"
      : "";

    var wrap = el(
      "<details class=\"dlv-dd\"" + (open ? " open" : "") + ">" +
        '<summary class="dlv-dd__sum"><code class="dlv-dom">' + esc(d.domain) + "</code>" +
          '<span class="dlv-dd__hint">deliverability detail \u2014 providers, receiving domains, reasons</span>' +
        "</summary>" +
        '<div class="dlv-dd__body">' +
          (findings ? '<div class="dlv__findings">' + findings + "</div>" : "") +
          comp +
          sliceTable("By mailbox provider",
            dv.providers,
            "Who is judging this domain. A rate that is fine overall but bad at one provider is a " +
            "reputation problem with that provider, not a list problem.") +
          sliceTable("By receiving domain",
            dv.receivingDomains,
            "Finer than the provider bucket \u2014 it separates hotmail.fr from outlook.fr, and " +
            "isolates the single inbox domain that can carry an entire bounce rate.") +
          deferralPanel +
          reasonTable("Why messages were delayed", dv.delayReasons,
            "The remote server\u2019s own words, verbatim. A 4.7.x string naming unsolicited mail or an " +
            "unusual rate is a reputation warning; a full-mailbox string is not.") +
          reasonTable("Why messages bounced", dv.bounceReasons,
            "Verbatim refusal strings, per receiving domain.") +
          classTable +
        "</div>" +
      "</details>"
    );
    return wrap;
  }

  function dlvTone(kind, v) {
    var b = DLV_BANDS[kind];
    if (!b || v === null || v === undefined || isNaN(v)) return "";
    if (b.higherIsBetter) return v >= b.good ? "ok" : v >= b.warn ? "warn" : "bad";
    return v <= b.good ? "ok" : v <= b.warn ? "warn" : "bad";
  }

  // Percentages in the per-domain tables are read down a column, so they keep the
  // decimals they were asked for rather than being trimmed: a 98.00% delivery rate
  // shortened to "98%" reads as a coarser measurement than the "99.97%" beside it.
  // Only an exact zero collapses, because there the absence is the whole message.
  function dlvPct(v, digits) {
    if (v === null || v === undefined || isNaN(v)) return "\u2014";
    var n = Number(v);
    if (n === 0) return "0%";
    var d = digits === undefined ? 2 : digits;
    // Same boundary guard as fmtPrec: a delivery rate below 100 must never print
    // as "100%", so a value that would round onto the ceiling gains a decimal.
    if (n > 99 && n < 100 && Number(n.toFixed(d)) >= 100) d = 3;
    return n.toFixed(d) + "%";
  }

  function dlvCell(kind, v, digits) {
    var tone = dlvTone(kind, v);
    return '<td class="dlv-num' + (tone ? " dlv-num--" + tone : "") + '">' + dlvPct(v, digits) + "</td>";
  }

  // A reason string is a raw SMTP response: long, often multi-line, and the useful
  // part is at the front. Keep the full text in a title attribute so nothing is lost.
  function dlvReason(s) {
    var raw = String(s || "").replace(/\\r\\n|\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
    var short = raw.length > 110 ? raw.slice(0, 110).replace(/\s+\S*$/, "") + "\u2026" : raw;
    return '<code class="dlv-reason" title="' + esc(raw) + '">' + esc(short || "\u2014") + "</code>";
  }

  function dlvBar(share) {
    var w = Math.max(0, Math.min(100, Number(share) || 0));
    return '<span class="dlv-bar"><span class="dlv-bar__fill" style="width:' + w.toFixed(1) + '%"></span></span>';
  }

  // Fold the SparkPost drill-down into the email KPI panel: findings between the
  // panel header and the cards, provider/reason detail after them. The account
  // totals are deliberately NOT rendered as tiles — every one of them already has
  // a KPI card above, where it is shown beside its Airship counterpart.
  function decorateEmailPanel(sec, d) {
    var findings = (d.findings || []).filter(function (x) { return x && x.title; });
    var cardsHost = sec.querySelector(".kpanel__cards");
    var head = sec.querySelector(".kpanel__head");

    if (d.sendingDomain || d.window) {
      var meta = [];
      if (d.sendingDomain) meta.push('<code class="dlv-dom">' + esc(d.sendingDomain) + "</code>");
      if (d.window) meta.push('<span class="dlv-win">' + esc(d.window) + "</span>");
      head.appendChild(el('<span class="dlv__meta">' + meta.join("") + "</span>"));
    }

    // The diagnosis goes first — it is what a TAM opens the page for.
    if (findings.length) {
      sec.insertBefore(
        el(
          '<div class="dlv__findings">' +
            findings
              .map(function (f) {
                var sev = f.severity === "danger" || f.severity === "warning" || f.severity === "success" ? f.severity : "info";
                return (
                  '<div class="dlv-find dlv-find--' + sev + '">' +
                    '<div class="dlv-find__title">' + esc(f.title) + "</div>" +
                    (f.detail ? '<div class="dlv-find__body">' + esc(f.detail) + "</div>" : "") +
                  "</div>"
                );
              })
              .join("") +
          "</div>"
        ),
        cardsHost
      );
    }

    var tail = dlvDetail(d);
    if (tail) sec.appendChild(tail);
  }

  function dlvDetail(d) {
    var providers = (d.providers || []).filter(function (x) { return x && x.name; });
    var delays = (d.delayReasons || []).filter(function (x) { return x && x.reason; });
    var bounces = (d.bounceClasses || []).filter(function (x) { return x && x.name; });
    if (!providers.length && !delays.length && !bounces.length) return null;

    var host = el('<div class="dlv__body"></div>');

    // Per-provider table — the axis Airship cannot give at all.
    if (providers.length) {
      var rows = providers
        .map(function (pr) {
          return (
            "<tr>" +
              '<td class="dlv-prov">' + esc(pr.name) + "</td>" +
              '<td class="dlv-share">' + dlvBar(pr.share) + '<span class="dlv-share__txt">' + dlvPct(pr.share, 1) + "</span></td>" +
              '<td class="dlv-num dlv-num--plain">' + esc(fmtCount(pr.injected)) + "</td>" +
              dlvCell("delivery", pr.deliveryRate, 2) +
              dlvCell("delay", pr.delayRate, 2) +
              dlvCell("bounce", pr.bounceRate, 2) +
              dlvCell("open", pr.openRate, 1) +
            "</tr>"
          );
        })
        .join("");
      host.appendChild(
        el(
          '<section class="panel dlv-panel">' +
            "<h3>By mailbox provider</h3>" +
            '<div class="dlv-tblwrap"><table class="dlv-tbl">' +
              "<thead><tr>" +
                "<th>Mailbox provider</th><th>Share of volume</th><th>Injected</th>" +
                "<th>Delivered</th><th>Delayed</th><th>Bounced</th><th>Opened</th>" +
              "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
          "</section>"
        )
      );
    }

    // 4. Reasons, side by side — the "why".
    var cols = "";
    if (delays.length) {
      cols +=
        '<section class="panel dlv-panel">' +
          "<h3>Why mail is delayed</h3>" +
          '<ul class="dlv-reasons">' +
            delays
              .map(function (r) {
                return (
                  '<li class="dlv-reasons__item">' +
                    '<div class="dlv-reasons__head"><span class="dlv-reasons__dom">' + esc(r.domain || "\u2014") + "</span>" +
                      '<span class="dlv-reasons__n">' + esc(fmtCount(r.count)) + "</span></div>" +
                    dlvReason(r.reason) +
                  "</li>"
                );
              })
              .join("") +
          "</ul>" +
        "</section>";
    }
    if (bounces.length) {
      var maxB = bounces.reduce(function (a, b) { return Math.max(a, Number(b.count) || 0); }, 0) || 1;
      cols +=
        '<section class="panel dlv-panel">' +
          "<h3>Why mail bounces</h3>" +
          '<ul class="dlv-classes">' +
            bounces
              .map(function (b) {
                var pctW = ((Number(b.count) || 0) / maxB) * 100;
                var cat = String(b.category || "").toLowerCase();
                var tone = cat === "hard" || cat === "block" ? "bad" : cat === "soft" ? "warn" : "";
                return (
                  '<li class="dlv-classes__item">' +
                    '<div class="dlv-classes__head">' +
                      '<span class="dlv-classes__name">' + esc(b.name) + "</span>" +
                      (b.category ? '<span class="dlv-cat' + (tone ? " dlv-cat--" + tone : "") + '">' + esc(b.category) + "</span>" : "") +
                      '<span class="dlv-classes__n">' + esc(fmtCount(b.count)) + "</span>" +
                    "</div>" +
                    '<span class="dlv-bar"><span class="dlv-bar__fill" style="width:' + pctW.toFixed(1) + '%"></span></span>' +
                  "</li>"
                );
              })
              .join("") +
          "</ul>" +
        "</section>";
    }
    if (cols) host.appendChild(el('<div class="dlv__cols">' + cols + "</div>"));

    // Provenance, so any number on this page can be traced back.
    var srcBits = [];
    srcBits.push(esc(d.source || "SparkPost Metrics API"));
    if (d.sendingDomain) srcBits.push("scoped to " + esc(d.sendingDomain));
    if (d.window) srcBits.push(esc(d.window));
    if (d.fetchedAt) srcBits.push("fetched " + esc(d.fetchedAt));
    var gm = d.gmailReputation;
    var gmTxt = gm && gm.reputation
      ? "Gmail domain reputation: <strong>" + esc(gm.reputation) + "</strong> (Google Postmaster Tools" + (gm.lastDay ? ", to " + esc(gm.lastDay) : "") + ")."
      : "Gmail domain reputation unavailable" + (gm && gm.reason ? ": " + esc(gm.reason) : " \u2014 Google Postmaster Tools not configured for this domain.");
    host.appendChild(
      el(
        '<p class="dlv__src">' + srcBits.join(" \u00B7 ") +
          ". SparkPost rates divide by <em>injections</em> and Airship by <em>sends</em>, so the two figures on a card " +
          "differ by design \u2014 they are not meant to reconcile. Health Score and inbox/spam placement are not exposed " +
          "by any API. " + gmTxt + "</p>"
      )
    );

    return host;
  }

  function kpiPanels(p) {
    var wrap = el(
      '<div class="psection">' +
        '<div class="psection__bar">' +
          '<h3 class="psection__title">All monitored KPIs</h3>' +
          '<button class="linkbtn linkbtn--ghost thbtn" type="button" data-project="' + esc(p.name) +
            '" title="Bulk-edit every threshold at once (advanced)">\u2699 Edit all thresholds</button>' +
        "</div>" +
        '<p class="psection__hint">Every monitored KPI on this project\u2019s active channels \u2014 value, 30-day vs previous-30-day evolution, history and a short read \u2014 with its alert threshold inline to compare and adjust on the card.</p>' +
        '<div class="kpanels"></div>' +
      "</div>"
    );
    var host = wrap.querySelector(".kpanels");
    var metrics = (p.metrics || []).filter(function (m) { return m && m.key; });
    if (!metrics.length) {
      host.appendChild(el('<div class="panel"><div class="note">No per-KPI depth in this snapshot yet. Run the skill (a recent version) to populate detailed metrics.</div></div>'));
      return wrap;
    }
    var byGroup = {};
    metrics.forEach(function (m) {
      var g = m.group || m.channel || "app";
      (byGroup[g] = byGroup[g] || []).push(m);
    });
    var order = CHANNEL_GROUPS.slice();
    // Append any groups not in the canonical order.
    Object.keys(byGroup).forEach(function (g) {
      if (!order.some(function (o) { return o.id === g; })) order.push({ id: g, label: g });
    });
    order.forEach(function (grp) {
      var list = byGroup[grp.id];
      if (!list || !list.length) return;
      list.sort(function (a, b) { return familyRank(a) - familyRank(b); });
      var cards = list.map(function (m) { return kpiCard(m, p); }).join("");
      var sec = el(
        '<section class="kpanel"><header class="kpanel__head">' + esc(grp.label) + "</header>" +
          '<div class="kpanel__cards">' + cards + "</div></section>"
      );
      // Everything email lives in ONE place: the SparkPost drill-down is appended
      // inside the email panel — diagnosis above the cards, provider/reason detail
      // below them — instead of forming a second, disconnected section.
      // When per-domain data exists it REPLACES the project-level drill-down
      // rather than sitting next to it: the project panel would be the largest
      // domain's numbers under a project heading, which reads as a fleet fact
      // and is not one. Older snapshots without emailDomains keep the old panel.
      if (grp.id === "email" && p.emailDomains) decorateEmailDomains(sec, p);
      else if (grp.id === "email" && p.deliverability) decorateEmailPanel(sec, p.deliverability);
      host.appendChild(sec);
    });
    return wrap;
  }

  // What ONE point of `series` represents, per family (SKILL.md Step 13). The card
  // headline is a 30-day window figure while most series are daily, so the chart sits
  // at roughly a thirtieth of the number printed above it; the convention also differs
  // between families (rates store daily rates, devices store snapshots).
  // Surfaced on the card so the chart cannot be misread as contradicting the value.
  var SERIES_BASIS = {
    app_opens: "daily points", push_sends: "daily points", email_sends: "daily points",
    web_sends: "daily points", sms_sends: "daily points", timeinapp: "daily points",
    optin_optout_ratio: "daily ratio", direct_response_rate: "daily rate",
    email_deliverability: "daily rate", email_open_rate: "daily rate",
    email_bounce: "daily rate", email_unsubscribe: "daily points",
    email_spam_complaint_rate: "daily rate", email_delay_rate: "daily rate",
    email_hard_bounce_rate: "daily rate", email_block_bounce_rate: "daily rate",
    email_click_rate: "daily rate", email_ctor: "daily rate", email_unsubscribe_rate: "daily rate",
    push_pressure_per_user: "rolling 30d, weekly points",
    total_devices_evolution: "snapshots", devices_optin: "snapshots",
    devices_uninstall: "snapshots",
  };

  // Per-KPI provenance: which Airship Reports API endpoint feeds the metric and
  // exactly how it is computed. Keyed by metric family (base key without the
  // _ios/_android/_web OS suffix) so it works retroactively on old snapshots
  // without re-running the skill. Mirrors SKILL.md "Data sources" table.
  var KPI_META = {
    app_opens: { src: "/api/reports/opens", calc: "\u03A3 daily app opens over the 30-day window, per OS (raw count). \u0394% = (current \u2212 previous 30 days) \u00F7 previous \u00D7 100." },
    timeinapp: { src: "/api/reports/timeinapp", calc: "Average time-in-app per day (Airship value), per OS. \u0394% vs the previous 30-day window." },
    push_sends: { src: "/api/reports/sends", calc: "\u03A3 push notifications sent over 30 days, per OS (raw count). \u0394% vs the previous 30 days." },
    push_pressure_per_user: { src: "/api/reports/sends \u00F7 /api/reports/devices?date=", calc: "Push pressure = push sends (iOS+Android) \u00F7 opted-in devices over the 30-day window (msg/user/30d). Denominator is the opted-in base at the window end via /api/reports/devices?date= (falls back to the current opted-in snapshot, labelled a proxy, if the dated call is unavailable). `series` is the rolling 30-day value sampled weekly, so it shares the headline's unit." },
    optin_optout_ratio: { src: "/api/reports/optins \u00F7 /api/reports/optouts", calc: "Daily opt-in \u00F7 opt-out ratio, per OS (iOS/Android only \u2014 neither endpoint returns web/SMS series). `series` IS the trend: the daily ratio across the 30-day window. A day with 0 opt-outs is EXCLUDED from the trend average and from `series` (undefined ratio) rather than shown as an artificial spike. \u0394% compares the current window's average ratio to the previous window's. Ratio > 1 = net-positive reach (more opt-ins than opt-outs that day); < 1 = churn-dominant." },
    direct_response_rate: { src: "/api/reports/responses", calc: "Click rate = direct responses (push clicks) \u00F7 push sends \u00D7 100, per OS, over the 30-day window. \u0394 in percentage points. Tracking-health signal." },
    total_devices_evolution: { src: "/api/reports/devices?date=<start> \u00B7 ?date=<end>", calc: "Total unique-device evolution, per OS + total = % growth/decline between two dated /api/reports/devices calls. GET /api/reports/devices?date=<date-time> counts all device events that occurred before that date-time and returns total_unique_devices + counts.{ios,android,\u2026}.unique_devices; evolution = (end \u2212 start) \u00F7 start \u00D7 100 over the window (start = window start, end = window end / today). Merges the former installs proxy and unique-devices trend into one." },
    devices_optin: { src: "/api/reports/devices?date=", calc: "Opted-in devices two-date evolution, per OS \u2014 the opt-in BASE, not opt-in events (see App & engagement \u2192 Opt-in/opt-out ratio for the event-level signal). \u0394% = change of counts.{os}.opted_in between the window-start and window-end dated calls." },
    devices_uninstall: { src: "/api/reports/devices?date=", calc: "Uninstalled-devices two-date evolution, per OS. \u0394% = change of counts.{os}.uninstalled between the window-start and window-end dated calls (a rise beyond the ceiling alerts)." },
    email_sends: { src: "/api/reports/sends", calc: "\u03A3 emails sent over 30 days (field `email`). \u0394% vs the previous 30 days." },
    email_deliverability: { src: "SparkPost Metrics API", calc: "Delivered \u00F7 injected \u00D7 100, per sending domain. The card shows the 30-day rate, but the ALERT is a fast check on the per-day rate over the last few days \u2014 a collapse must not wait for the monthly average to move." },
    email_open_rate: { src: "SparkPost Metrics API", calc: "Unique confirmed opens \u00F7 delivered \u00D7 100, per sending domain. \u0394 in percentage points vs the previous 30 days." },
    email_bounce: { src: "SparkPost Metrics API", calc: "Bounces \u00F7 injected \u00D7 100, per sending domain. The card shows the 30-day rate, but the ALERT is a fast check on the per-day rate over the last few days." },
    email_unsubscribe: { src: "SparkPost Metrics API", calc: "Unsubscribes over the window, per sending domain; \u0394% vs the previous 30 days." },
    email_spam_complaint_rate: { src: "SparkPost Metrics API", calc: "Daily spam complaints \u00F7 delivered \u00D7 100 (precision=day), per sending domain. Fast check: evaluated per day, never averaged over the window." },
    email_hard_bounce_rate: { src: "SparkPost Metrics API", calc: "Hard bounces \u00F7 injected \u00D7 100, per sending domain. The address does not exist \u2014 this is the bounce type that gets a sender blocklisted, and the reason total bounce is split apart." },
    email_block_bounce_rate: { src: "SparkPost Metrics API", calc: "Block bounces \u00F7 injected \u00D7 100, per sending domain. The receiver refused on policy rather than because the address is bad: a reputation signal, not a list-quality one." },
    email_unsubscribe_rate: { src: "SparkPost Metrics API", calc: "Unsubscribes \u00F7 delivered \u00D7 100. Catches a rate that is high but stable, which the rise-based key never fires on." },
    email_click_rate: { src: "SparkPost Metrics API", calc: "Unique clicks \u00F7 delivered \u00D7 100, per sending domain." },
    email_ctor: { src: "SparkPost Metrics API", calc: "Unique clicks \u00F7 unique opens \u00D7 100. Apple Mail Privacy Protection pre-opens messages and inflates open rate; click-to-open is the engagement signal it cannot touch." },
    email_delay_rate: { src: "SparkPost Metrics API", calc: "Messages deferred on their FIRST attempt \u00F7 injected \u00D7 100 (count_delayed_first), per sending domain \u2014 bounded by 100%, unlike the retry-event ratio it replaced. Fast check on the most recent days." },
    web_sends: { src: "/api/reports/sends", calc: "\u03A3 web-push sends over 30 days (field `web`). \u0394% vs the previous 30 days." },
    sms_sends: { src: "/api/reports/sends", calc: "\u03A3 SMS sends over 30 days (field `sms`). \u0394% vs the previous 30 days." },
  };
  // Resolve the KPI family name for a metric key by longest matching family.
  // Canonical metric keys equal the family name exactly (e.g. "app_opens",
  // "direct_response_rate"); the longest-prefix fallback keeps old snapshots that
  // baked OS/direction into the key (e.g. "app_opens_ios") still resolving.
  function kpiFamily(key) {
    var k = String(key || "");
    var best = null;
    Object.keys(KPI_META).forEach(function (fam) {
      if (k === fam || k.indexOf(fam + "_") === 0) {
        if (!best || fam.length > best.length) best = fam;
      }
    });
    return best;
  }
  // Resolve the provenance entry for a metric key by longest matching family.
  function kpiMeta(key) {
    var fam = kpiFamily(key);
    return fam ? KPI_META[fam] : null;
  }
  // Canonical within-section ordering of KPI families, so cards render in a
  // consistent, sensible order regardless of the emit order in dashboard-data.js.
  var FAMILY_ORDER = [
    "app_opens", "timeinapp", "optin_optout_ratio",
    "push_sends", "push_pressure_per_user", "direct_response_rate",
    "total_devices_evolution", "devices_optin", "devices_uninstall",
    "email_sends", "email_deliverability", "email_bounce", "email_hard_bounce_rate",
    "email_block_bounce_rate", "email_open_rate", "email_click_rate", "email_ctor",
    "email_unsubscribe_rate",
    "email_unsubscribe", "email_spam_complaint_rate", "email_delay_rate",
    "web_sends",
    "sms_sends",
  ];
  function familyRank(m) {
    var i = FAMILY_ORDER.indexOf(kpiFamily(m && m.key));
    return i === -1 ? FAMILY_ORDER.length : i;
  }

  // The skill's suggestion for a given threshold key (shown inline on the card).
  function metricSuggestion(p, key) {
    var list = (p && p.thresholdSuggestions) || [];
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].key === key) return list[i];
    return null;
  }

  // Inline threshold editor rendered on each KPI card, right under the headroom
  // gauge — so the alert threshold sits next to the live result and its chart and
  // can be read, compared and adjusted in place (no centralized modal needed).
  function inlineThreshold(p, m) {
    var t = m.threshold;
    if (!t || !t.key) return "";
    var key = t.key;
    var it = catalogItem(key);
    var unit = it && it.unit ? it.unit : "";
    var uSuffix = unit === "pts" ? " pts" : unit === "%" ? "%" : "";
    var ov = serverOverrides(p.name)[key];
    var def = it && it.default != null ? it.default : null;
    var effective = ov != null ? ov : (t.value != null ? t.value : def);
    var kindTxt = t.kind ? esc(t.kind) : "";
    var badge = ov != null
      ? '<span class="kthr__tag kthr__tag--ov" title="Custom threshold in your clients.yml">override</span>'
      : '<span class="kthr__tag kthr__tag--def" title="Skill default (no override)">default</span>';

    var s = metricSuggestion(p, key);
    var dismissed = dismissedSet(p.name, p);
    var sugHtml = "";
    if (s && !dismissed[key]) {
      var isApplied = ov != null && Number(ov) === Number(s.suggested);
      var dirArrow = s.direction === "tighten" ? "\u25BC tighten" : "\u25B2 loosen";
      var conf = s.confidence || "low";
      var basisLbl = { volatility: "volatility", false_positives: "false positives", headroom: "chronic headroom" }[s.basis] || (s.basis || "");
      sugHtml =
        '<div class="kthr__sug' + (isApplied ? " kthr__sug--applied" : "") + '">' +
          '<div class="kthr__sug-head">' +
            '<span class="th__dir th__dir--' + esc(s.direction || "") + '">' + dirArrow + "</span>" +
            '<span class="kthr__sug-val">suggest <strong>' + esc(s.suggested) + esc(uSuffix) + "</strong></span>" +
            '<span class="th__conf th__conf--' + esc(conf) + '" title="Confidence">' + esc(conf) + "</span>" +
            (isApplied
              ? '<span class="kthr__applied">\u2713 applied</span>'
              : '<button class="btn btn--sm btn--primary kthr-apply" type="button" data-project="' + esc(p.name) + '" data-key="' + esc(key) + '" data-val="' + esc(s.suggested) + '">Apply</button>') +
            '<button class="btn btn--sm kthr-dismiss" type="button" data-project="' + esc(p.name) + '" data-key="' + esc(key) + '" title="Dismiss this suggestion (the skill stops re-emitting it)">Dismiss</button>' +
          "</div>" +
          '<div class="th__why"><span class="th__basis">' + esc(basisLbl) + "</span> " + esc(s.rationale || "") + "</div>" +
        "</div>";
    }

    return (
      '<div class="kthr" data-project="' + esc(p.name) + '" data-key="' + esc(key) + '"' +
        (def != null ? ' data-default="' + esc(def) + '"' : "") + ">" +
        '<div class="kthr__row">' +
          '<span class="kthr__lbl">Alert threshold' + (kindTxt ? ' <span class="kthr__kind">' + kindTxt + "</span>" : "") + "</span>" +
          '<span class="kthr__ctl">' +
            '<input class="kthr__input" type="number" step="any" inputmode="decimal" value="' +
              esc(effective == null ? "" : effective) + '" placeholder="' + esc(def == null ? "" : def) +
              '" aria-label="Alert threshold for ' + esc(it ? it.label : key) + '" />' +
            (uSuffix ? '<span class="kthr__unit">' + esc(uSuffix.trim()) + "</span>" : "") +
            '<button class="btn btn--sm btn--primary kthr-set" type="button">Set</button>' +
            '<button class="btn btn--sm kthr-reset" type="button" title="Reset to default' +
              (def != null ? " (" + esc(def) + esc(uSuffix) + ")" : "") + '">Reset</button>' +
            badge +
          "</span>" +
        "</div>" +
        sugHtml +
      "</div>"
    );
  }

  // Per-KPI analysis sentence: prefer the skill-authored, client-contextualized
  // `analysis`; otherwise fall back to a deterministic one-liner built from the
  // numbers we already have (30-day direction/magnitude + headroom / breach state).
  function analysisText(m) {
    if (m.analysis && String(m.analysis).trim()) return String(m.analysis).trim();
    return metricAnalysisFallback(m);
  }
  function metricAnalysisFallback(m) {
    if (m.status === "na") return "Below the minimum-volume floor \u2014 not evaluated this run.";
    var parts = [];
    var d = typeof m.deltaPts === "number" ? m.deltaPts : (typeof m.deltaPct === "number" ? m.deltaPct : null);
    var unit = typeof m.deltaPts === "number" ? " pts" : "%";
    if (d != null) {
      if (d === 0) parts.push("Flat vs the previous 30 days");
      else parts.push((d > 0 ? "Up" : "Down") + " " + fmt1(Math.abs(d)) + unit + " vs the previous 30 days");
    }
    var t = m.threshold;
    if (t) {
      if (t.breaching) parts.push("breaching its alert threshold");
      else if (typeof t.headroom === "number") {
        var u = thresholdUnit(t);
        var us = u === "pts" ? " pts" : u === "%" ? "%" : "";
        parts.push(fmt1(t.headroom) + us + " of headroom before alert");
      }
    }
    if (!parts.length) return "";
    return parts.join(" \u00B7 ") + ".";
  }

  // Find alertsList entries that relate to metric m by substring-matching the
  // family key. A small override map handles the two device families where the OS
  // is injected in the middle of the alert key (e.g. devices_ios_optin_drop).
  var _ALERT_ALT = { devices_optin: "optin_drop", devices_uninstall: "uninstall_rise" };
  function alertsForMetric(p, m) {
    if (!m || !m.key) return [];
    var mk = m.key.toLowerCase().replace(/_rate$/, "");
    var alt = _ALERT_ALT[m.key];
    var dropOnly = DROP_ONLY_METRICS[m.key];
    return (p.alertsList || []).filter(function (a) {
      if (!a || !a.key) return false;
      var ak = a.key.toLowerCase();
      if (ak.indexOf(mk) === -1 && !(alt && ak.indexOf(alt) !== -1)) return false;
      // On a volume KPI, only a fall is actionable — a cross-OS gap or a rise
      // guard reaching this card is noise the TAM cannot do anything with.
      return dropOnly ? isDropAlertKey(ak) : true;
    });
  }

  var SOURCE_LABEL = { airship: "Airship", sparkpost: "SparkPost", postmaster: "Postmaster" };

  // Which figure a card leads with. Most KPIs have exactly one source (Airship);
  // the email family can have two, and then `sources.primary` decides. Airship and
  // SparkPost measure the same KPI on different denominators — sends vs injections
  // — so the loser is kept visible rather than dropped, never silently averaged.
  function primarySource(m) {
    var s = m.sources;
    if (!s) return null;
    var key = s.primary && s[s.primary] ? s.primary : null;
    if (!key) {
      key = Object.keys(s).filter(function (k) { return k !== "primary" && k !== "note" && s[k]; })[0] || null;
    }
    return key;
  }

  // The headline figures, taken from the primary source so value, previous and
  // delta on a card always come from the SAME measurement.
  function headlineFigures(m) {
    var key = primarySource(m);
    var s = key ? m.sources[key] : null;
    if (!s || typeof s.current !== "number") {
      return { current: m.current, previous: m.previous, deltaPct: m.deltaPct, deltaPts: m.deltaPts };
    }
    return { current: s.current, previous: s.previous, deltaPct: s.deltaPct, deltaPts: s.deltaPts };
  }

  function sourceChip(m) {
    var key = primarySource(m);
    var label = key ? SOURCE_LABEL[key] || key : "Airship";
    return '<span class="ksrc ksrc--' + esc(key || "airship") + '">' + esc(label) + "</span>";
  }

  // The non-primary source(s), kept on the card so the same KPI is never shown
  // twice on the page. Also states which figure the alert threshold runs on,
  // because that is the Airship one even when SparkPost leads the card.
  function secondarySources(m) {
    var key = primarySource(m);
    if (!key || !m.sources) return "";
    var bits = Object.keys(m.sources)
      .filter(function (k) { return k !== "primary" && k !== "note" && k !== key && m.sources[k]; })
      .map(function (k) {
        var s = m.sources[k];
        if (typeof s.current !== "number") return "";
        return (
          '<span class="kalt__item"><span class="kalt__src">' + esc(SOURCE_LABEL[k] || k) + "</span> " +
            fmtVal(s.current, m.unit) +
            (typeof s.previous === "number" ? '<span class="kalt__prev">prev ' + fmtVal(s.previous, m.unit) + "</span>" : "") +
          "</span>"
        );
      })
      .filter(Boolean);
    var noteTxt = m.sources.note || "";
    if (key !== "airship" && m.threshold && typeof m.threshold.headroom === "number") {
      noteTxt = (noteTxt ? noteTxt + " " : "") + "The alert threshold below is evaluated on the Airship figure.";
    }
    if (!bits.length && !noteTxt) return "";
    return (
      '<div class="kcard__alt">' +
        (bits.length ? '<div class="kalt__row">' + bits.join("") + "</div>" : "") +
        (noteTxt ? '<div class="kalt__note">' + esc(noteTxt) + "</div>" : "") +
      "</div>"
    );
  }

  function kpiCard(m, p) {
    var t = m.threshold || {};
    var hl = headlineFigures(m);
    // Per-OS row. Each OS shows its 30-day delta chip when a `deltaPct` is present
    // (volume/rate KPIs), else its current absolute snapshot `value` (device /
    // device snapshots with only one dated call this run). Includes
    // web when the metric carries it.
    var osHtml = "";
    if (m.os) {
      var parts = [];
      [["ios", "iOS"], ["android", "Android"], ["web", "Web"]].forEach(function (pair) {
        var o = m.os[pair[0]];
        if (!o) return;
        if (typeof o.deltaPct === "number") parts.push('<span class="os">' + pair[1] + " " + deltaChip({ deltaPct: o.deltaPct }) + "</span>");
        else if (typeof o.value === "number") parts.push('<span class="os">' + pair[1] + " " + fmtCount(o.value) + "</span>");
      });
      if (parts.length) osHtml = '<div class="kcard__os">' + parts.join("") + "</div>";
    }
    // Keep full {t,v} points so the click-to-expand chart can label dates; the
    // compact tile sparkline still uses values only (density unchanged).
    var fullSeries = (m.series || []).map(function (s) {
      return typeof s === "object" ? { t: s.t, v: s.v } : { t: null, v: s };
    });
    var series = fullSeries.map(function (s) { return s.v; });
    // History chart is always represented: a compact sparkline once there are ≥2
    // points (wrapped in a click-to-expand affordance opening a large interactive
    // chart), otherwise a discreet "history building" placeholder (skipped for na).
    var sparkHtml;
    if (series.length >= 2) {
      var seriesAttr = esc(encodeURIComponent(JSON.stringify(fullSeries)));
      var basisTxt = SERIES_BASIS[kpiFamily(m.key)] || "";
      sparkHtml =
        '<button class="kcard__spark kcard__spark-expand" type="button"' +
          ' data-series="' + seriesAttr + '" data-label="' + esc(m.label || m.key) + '" data-unit="' + esc(m.unit || "") + '"' +
          ' title="Expand interactive chart" aria-label="Expand history chart for ' + esc(m.label || m.key) + '">' +
          lineSparkline(series, 150, 30) +
          '<span class="kcard__spark-hint">' + (basisTxt ? esc(basisTxt) + " \u00B7 " : "") + "\u2922 expand</span>" +
        "</button>";
    } else {
      sparkHtml = m.status === "na" ? "" : '<div class="kcard__spark kcard__spark--empty">\uD83D\uDCC8 History building\u2026</div>';
    }
    // Any raw-count metric may carry an optional `rate` object so the raw count
    // is read alongside a per-send rate (kept for backward compatibility).
    var rateHtml = "";
    if (m.rate) {
      var r = m.rate;
      if (typeof r.current === "number") {
        var dir = typeof r.deltaPct === "number"
          ? (r.deltaPct > 0 ? "up" : r.deltaPct < 0 ? "down" : "flat")
          : "flat";
        var arrow = dir === "up" ? "\u25B2" : dir === "down" ? "\u25BC" : "\u25AC";
        var deltaTxt = typeof r.deltaPct === "number" ? " (" + arrow + " " + Math.abs(r.deltaPct).toFixed(1) + "% vs prev 30d)" : "";
        rateHtml =
          '<div class="kcard__rate kcard__rate--' + dir + '">' +
            "Rate/send " + r.current.toFixed(1) + "% " +
            '<span class="kcard__rate-prev">prev ' + (typeof r.previous === "number" ? r.previous.toFixed(1) + "%" : "\u2014") + "</span>" +
            '<span class="kcard__rate-delta">' + esc(deltaTxt) + "</span>" +
          "</div>";
      } else if (r.note) {
        rateHtml = '<div class="kcard__rate kcard__rate--flat">Rate/send: ' + esc(r.note) + "</div>";
      }
    }
    var noteHtml = m.note ? '<div class="kcard__note">' + esc(m.note) + "</div>" : "";
    var aTxt = analysisText(m);
    var analysisHtml = aTxt ? '<p class="kcard__analysis">' + esc(aTxt) + "</p>" : "";
    var meta = kpiMeta(m.key);
    var metaHtml = meta
      ? '<details class="kcard__meta"><summary>Source &amp; calc</summary>' +
          '<div class="kcard__src">Source <code>' + esc(meta.src) + "</code></div>" +
          '<div class="kcard__calc">' + esc(meta.calc) + "</div>" +
        "</details>"
      : "";
    var wKey = (m.threshold && m.threshold.key) || m.key;
    var ctx = wKey ? watchedMap(p.name, p)[wKey] : null;
    var st = metricAlertState(p, m);
    var alertMatches = st.alerts;

    // Two separate controls, because they answer two different questions.
    // "Alerts off" is a lasting decision about the guard on this client; "Dismiss"
    // acknowledges the occurrence in front of you and lets the next one through.
    var actions = "";
    if (st.off) {
      var uEntry = alertMatches.filter(function (a) { return a.muted; })[0];
      actions += '<button class="mutebtn mutebtn--unmute kcard__mutebtn" type="button"' +
        ' data-action="unmute" data-project="' + esc(p.name) + '" data-key="' +
        esc(uEntry ? uEntry.key : wKey) + '" title="Turn alerts back on for this KPI">Alerts on</button>';
    } else {
      if (st.active.length) {
        var aEntry = st.active[0];
        actions += '<button class="mutebtn kcard__mutebtn" type="button" data-action="dismiss-alert"' +
          ' data-project="' + esc(p.name) + '" data-key="' + esc(aEntry.key) + '"' +
          ' data-opened="' + esc(aEntry.openedAt || "") + '"' +
          ' title="Acknowledge this occurrence only \u2014 a new one will be raised again">Dismiss</button>';
      } else if (st.dismissed.length) {
        actions += '<button class="mutebtn mutebtn--unmute kcard__mutebtn" type="button" data-action="undismiss-alert"' +
          ' data-project="' + esc(p.name) + '" data-key="' + esc(st.dismissed[0].key) + '"' +
          ' title="Bring this alert back">Undismiss</button>';
      }
      actions += '<button class="mutebtn kcard__mutebtn" type="button" data-action="mute"' +
        ' data-project="' + esc(p.name) + '" data-key="' + esc(wKey) + '"' +
        ' title="Stop alerting on this KPI for this client, for good">Alerts off</button>';
    }

    // Cause / openedAt from the alert that actually drives the card.
    var causeEntry = st.active[0] || st.dismissed[0] ||
      alertMatches.filter(function (a) { return a.muted; })[0] || alertMatches[0];
    var causeHtml = "";
    if (causeEntry && (causeEntry.cause || causeEntry.note || causeEntry.openedAt)) {
      var causeText = causeEntry.cause || causeEntry.note || "";
      var offReasonTxt = st.off && causeEntry.reason ? " \u00B7 Alerts off: " + causeEntry.reason : "";
      causeHtml = '<div class="kcard__alert-cause' + (st.active.length ? " kcard__alert-cause--live" : "") + '">' +
        (causeEntry.openedAt ? '<span class="kcard__alert-since">Since ' + esc(causeEntry.openedAt) + "</span> " : "") +
        (causeText ? esc(causeText) : "") +
        (offReasonTxt ? ' <span class="kcard__mute-reason">' + esc(offReasonTxt) + "</span>" : "") +
      "</div>";
    }
    // Context: a standing note about what this KPI means for THIS client, kept in
    // clients.yml so each run reads it back. The chip is the "there is context
    // here" marker — without it the note reads as an accident of the last run.
    var ctxChipHtml = '<button class="ctxchip' + (ctx ? " ctxchip--set" : "") + '" type="button"' +
      ' data-action="context" data-project="' + esc(p.name) + '" data-key="' + esc(wKey) + '"' +
      ' title="' + esc(ctx ? "Context: " + (ctx.reason || "(no note)") : "Add context for this KPI") + '">' +
      (ctx ? "\uD83D\uDCCC Context" : "\uFF0B Context") + "</button>";
    var ctxNoteHtml = (ctx && ctx.reason)
      ? '<div class="kcard__ctx-note"><strong>Context</strong> ' + esc(ctx.reason) +
        (ctx.since ? ' <span class="kcard__ctx-since">since ' + esc(ctx.since) + "</span>" : "") + "</div>"
      : "";
    return (
      '<article class="kcard kcard--' + metricStatus(p, m).c + (ctx ? " kcard--hasctx" : "") + '"' +
        ' id="' + esc(metricAnchor(m)) + '">' +
        // Title row carries the label and the status, nothing else. Adding the
        // context chip and the action buttons here left the identity block with no
        // room: the label wrapped one word per line and the key fragmented into
        // "ema il_ ope n_r ate". The controls get their own row below.
        '<div class="kcard__top">' +
          '<span class="kcard__label">' + esc(m.label || m.key) + "</span>" +
          statusChip(p, m) +
        "</div>" +
        '<div class="kcard__toolbar">' +
          '<code class="kcard__key">' + esc(m.key) + "</code>" + sourceChip(m) +
          '<span class="kcard__actions">' + ctxChipHtml + actions + "</span>" +
        "</div>" +
        ctxNoteHtml +
        causeHtml +
        '<div class="kcard__vals">' +
          '<span class="kcard__cur">' + fmtVal(hl.current, m.unit) + "</span>" +
          (typeof hl.previous === "number" ? '<span class="kcard__prev">prev ' + fmtVal(hl.previous, m.unit) + "</span>" : "") +
          (deltaChip(hl) ? '<span class="kcard__delta">vs prev 30d ' + deltaChip(hl) + "</span>" : "") +
        "</div>" +
        secondarySources(m) +
        rateHtml +
        analysisHtml +
        noteHtml +
        osHtml +
        sparkHtml +
        headroomGauge(t, thresholdUnit(t)) +
        inlineThreshold(p, m) +
        metaHtml +
      "</article>"
    );
  }

  // Threshold suggestions that have no matching KPI card this run (so they can't be
  // shown inline). Per-KPI thresholds are now edited inline on each card; this panel
  // only surfaces these "orphan" suggestions so nothing is lost. Returns an empty
  // fragment (renders nothing) when every suggestion is already shown inline.
  function thresholdsPanel(p) {
    var shownKeys = {};
    (p.metrics || []).forEach(function (m) { if (m && m.threshold && m.threshold.key) shownKeys[m.threshold.key] = true; });
    var dismissed = dismissedSet(p.name, p);
    var orphans = (p.thresholdSuggestions || []).filter(function (s) { return s && s.key && !shownKeys[s.key] && !dismissed[s.key]; });
    if (!orphans.length) return document.createDocumentFragment();

    var overrides = serverOverrides(p.name);
    var wrap = el('<div class="psection"><h3 class="psection__title">Other threshold suggestions</h3><div class="panel thpanel"></div></div>');
    var host = wrap.querySelector(".thpanel");
    host.appendChild(el('<p class="note">Suggestions for KPIs not evaluated in this run (no card above). ' +
      (APP.serverMode ? "Apply writes your local clients.yml." : "Apply/Reset copy a prompt for Cursor chat.") + "</p>"));

    var rows = orphans.map(function (s) {
      var it = catalogItem(s.key);
      var unit = it && it.unit ? (it.unit === "pts" ? " pts" : it.unit === "%" ? "%" : "") : "";
      var eff = overrides[s.key];
      var effVal = eff != null ? eff : (s.current != null ? s.current : (it ? it.default : "\u2014"));
      var dirArrow = s.direction === "tighten" ? "\u25BC tighten" : "\u25B2 loosen";
      var conf = s.confidence || "low";
      var basisLbl = { volatility: "volatility", false_positives: "false positives", headroom: "chronic headroom" }[s.basis] || (s.basis || "");
      var isApplied = eff != null && Number(eff) === Number(s.suggested);
      return (
        "<tr" + (isApplied ? ' class="th__row--applied"' : "") + ">" +
          '<td class="th__k"><span class="th__label">' + esc(it ? it.label : s.key) + "</span><code>" + esc(s.key) + "</code></td>" +
          '<td class="th__eff">' + esc(effVal) + esc(unit) + (eff != null ? ' <span class="th__ov">' + (isApplied ? "\u2713 applied" : "override") + "</span>" : "") + "</td>" +
          '<td class="th__sug"><span class="th__dir th__dir--' + esc(s.direction || "") + '">' + dirArrow + "</span> " +
            '<strong>' + esc(s.suggested) + esc(unit) + "</strong>" +
            '<span class="th__conf th__conf--' + esc(conf) + '" title="Confidence">' + esc(conf) + "</span>" +
            '<div class="th__why"><span class="th__basis">' + esc(basisLbl) + "</span> " + esc(s.rationale || "") + "</div></td>" +
          '<td class="th__act">' +
            (isApplied
              ? '<span class="th__applied-badge">\u2713 Applied</span>'
              : '<button class="btn btn--sm btn--primary th-apply" data-project="' + esc(p.name) + '" data-key="' + esc(s.key) + '" data-val="' + esc(s.suggested) + '">Apply</button>') +
            '<button class="btn btn--sm th-reset" data-project="' + esc(p.name) + '" data-key="' + esc(s.key) + '">Reset</button>' +
            '<button class="btn btn--sm th-dismiss" data-project="' + esc(p.name) + '" data-key="' + esc(s.key) + '" title="Dismiss this suggestion (the skill stops re-emitting it)">Dismiss</button>' +
          "</td>" +
        "</tr>"
      );
    }).join("");
    host.appendChild(
      el(
        '<table class="thtable"><thead><tr><th>Threshold</th><th>Effective</th><th>Suggested</th><th></th></tr></thead>' +
          "<tbody>" + rows + "</tbody></table>"
      )
    );
    return wrap;
  }

  // Apply a single suggested threshold (served: POST; file://: copy-prompt).
  function applySuggestion(project, key, val) {
    if (!APP.serverMode) { copyModal("Apply threshold \u2014 paste into chat", setThresholdPrompt(project, key, val)); return; }
    var o = {}; o[key] = Number(val);
    api("/api/thresholds", { project: project, overrides: o })
      .then(function () { rerender(); toast("Applied " + key + " = " + val); })
      .catch(function (e) { toast("Error: " + e.message, "danger"); });
  }
  // Persist a manually-typed threshold (served: POST; file://: copy-prompt).
  function saveThreshold(project, key, val) {
    if (!APP.serverMode) { copyModal("Set threshold \u2014 paste into chat", setThresholdPrompt(project, key, val)); return; }
    var o = {}; o[key] = Number(val);
    api("/api/thresholds", { project: project, overrides: o })
      .then(function () { rerender(); toast("Set " + key + " = " + val); })
      .catch(function (e) { toast("Error: " + e.message, "danger"); });
  }
  // Inline "Set": validate the card input, then persist — blank or the default value
  // clears the override (reset) so the card falls back to the skill default.
  function inlineThresholdSave(box) {
    var project = box.getAttribute("data-project");
    var key = box.getAttribute("data-key");
    var input = box.querySelector(".kthr__input");
    var raw = String(input.value || "").trim();
    if (raw === "") { resetThreshold(project, key); return; }
    var num = Number(raw);
    if (isNaN(num)) { input.classList.add("bad"); toast("Enter a number", "danger"); return; }
    input.classList.remove("bad");
    var defAttr = box.getAttribute("data-default");
    var def = defAttr == null || defAttr === "" ? null : Number(defAttr);
    if (def != null && num === def) { resetThreshold(project, key); return; }
    saveThreshold(project, key, num);
  }
  function resetThreshold(project, key) {
    if (!APP.serverMode) { copyModal("Reset threshold \u2014 paste into chat", resetThresholdPrompt(project, key)); return; }
    var o = {}; o[key] = null;
    api("/api/thresholds", { project: project, overrides: o })
      .then(function () { rerender(); toast("Reset " + key + " to default"); })
      .catch(function (e) { toast("Error: " + e.message, "danger"); });
  }
  // Dismiss a threshold suggestion (served: POST; file://: copy-prompt). The skill
  // reads clients.yml `dismissed_suggestions` and stops re-emitting the suggestion.
  function dismissSuggestion(project, key) {
    if (!APP.serverMode) { copyModal("Dismiss suggestion \u2014 paste into chat", dismissSuggestionPrompt(project, key)); return; }
    api("/api/dismiss-suggestion", { project: project, key: key })
      .then(function () { rerender(); toast("Dismissed suggestion " + key); })
      .catch(function (e) { toast("Error: " + e.message, "danger"); });
  }
  // Context: a standing note explaining what a KPI means for THIS client — a
  // seasonal send pattern, a known migration, a threshold the client asked for.
  // It lives in clients.yml, so every later run reads it back instead of the TAM
  // re-deriving it. Editable and clearable from the same dialog.
  function onContext(project, key) {
    var found = findProject(APP.data, project);
    var existing = (watchedMap(project, found && found.project) || {})[key] || null;
    var prior = existing ? existing.reason || "" : "";
    if (!APP.serverMode) { copyModal("Context \u2014 paste into chat", contextPrompt(project, key, prior)); return; }
    var acts = [
      { label: existing ? "Save" : "Add context", primary: true, onClick: function (close, dlg, st) {
        var r = dlg.querySelector("#wReason").value.trim();
        if (!r) { st.style.color = "var(--danger)"; st.textContent = "Write a note, or use Clear."; return; }
        st.textContent = "Saving\u2026";
        api("/api/watch", { project: project, key: key, reason: r })
          .then(function () { close(); rerender(); toast("Context saved for " + key); })
          .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
      } },
    ];
    if (existing) {
      acts.unshift({ label: "Clear", onClick: function (close, dlg, st) {
        st.textContent = "Clearing\u2026";
        api("/api/unwatch", { project: project, key: key })
          .then(function () { close(); rerender(); toast("Context cleared for " + key); })
          .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
      } });
    }
    var m = modal({
      title: existing ? "Edit context" : "Add context",
      bodyHtml:
        '<p class="dialog__hint">What should anyone reading <code>' + esc(key) + "</code> on <strong>" + esc(project) +
        "</strong> know? Kept in <code>clients.yml</code> and read back on every run, so it survives this snapshot.</p>" +
        '<label class="fld"><span>Context</span>' +
        '<textarea class="dialog__text" id="wReason" rows="4" placeholder="e.g. sends are seasonal \u2014 two peaks a year around the sales"></textarea></label>' +
        (existing && existing.since ? '<p class="dialog__hint">Recorded ' + esc(existing.since) + ".</p>" : ""),
      actions: acts,
    });
    if (prior) m.dialog.querySelector("#wReason").value = prior;
  }

  // Dismiss THIS occurrence. Pinned to the alert's openedAt, so when the alert
  // resolves and later re-opens the dismissal no longer matches and the card
  // lights up again. This is the "false positive / threshold just adjusted"
  // action — turning the guard off for good is a different button.
  function onDismissAlert(project, key, opened) {
    if (!APP.serverMode) { copyModal("Dismiss alert \u2014 paste into chat", dismissAlertPrompt(project, key)); return; }
    var m = modal({
      title: "Dismiss this alert",
      bodyHtml:
        '<p class="dialog__hint">Acknowledge the current <code>' + esc(key) + "</code> alert on <strong>" + esc(project) +
        "</strong>. It stops counting as open" + (opened ? " (opened " + esc(opened) + ")" : "") +
        ". If the alert resolves and comes back later, it will be raised again \u2014 use <em>Alerts off</em> " +
        "to silence the guard for good.</p>" +
        '<label class="fld"><span>Reason (optional)</span>' +
        '<textarea class="dialog__text" id="dReason" rows="3" placeholder="e.g. threshold adjusted, expected after the migration"></textarea></label>',
      actions: [
        { label: "Dismiss", primary: true, onClick: function (close, dlg, st) {
          st.textContent = "Saving\u2026";
          api("/api/dismiss-alert", { project: project, key: key, opened: opened || "", reason: dlg.querySelector("#dReason").value.trim() })
            .then(function () { close(); rerender(); toast("Dismissed " + key); })
            .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
        } },
      ],
    });
    return m;
  }
  function onUndismissAlert(project, key) {
    if (!APP.serverMode) { copyModal("Undismiss alert \u2014 paste into chat", undismissAlertPrompt(project, key)); return; }
    api("/api/undismiss-alert", { project: project, key: key })
      .then(function () { rerender(); toast("Restored " + key); })
      .catch(function (e) { toast("Error: " + e.message, "danger"); });
  }

  // --- Setup view ------------------------------------------------------------
  var SETUP_FIELDS = [
    { k: "name", label: "Project name", ph: "e.g. Acme FR PROD" },
    { k: "brand_name", label: "Brand name", ph: "Display name (defaults to project name)" },
    { k: "airship_mcp", label: "Airship MCP server", ph: "e.g. user-Acme PROD" },
    { k: "slack_channel", label: "Slack channel", ph: "e.g. cs-acme (no #)" },
    { k: "slack_canvas_id", label: "Slack canvas ID", ph: "blank on first run" },
    { k: "time_zone", label: "Time zone (IANA)", ph: "e.g. Europe/Paris" },
  ];

  function clientFormHtml(c, isNew) {
    c = c || {};
    var fields = SETUP_FIELDS.map(function (f) {
      var v = c[f.k] == null ? "" : c[f.k];
      return (
        '<label class="fld"><span>' + esc(f.label) + "</span>" +
          '<input data-f="' + f.k + '" type="text" value="' + esc(v) + '" placeholder="' + esc(f.ph) + '" /></label>'
      );
    }).join("");
    var region = String(c.region || "eu").toLowerCase();
    var regionSel =
      '<label class="fld"><span>Region</span><select data-f="region">' +
        '<option value="eu"' + (region === "eu" ? " selected" : "") + ">eu</option>" +
        '<option value="us"' + (region === "us" ? " selected" : "") + ">us</option>" +
      "</select></label>";
    var industrySel =
      '<label class="fld"><span>Industry (benchmark vertical)</span><select data-f="industry">' +
        verticalOptions(String(c.industry || "all_verticals")) +
      "</select></label>";
    var enabled = c.enabled !== false;
    var enabledChk =
      '<label class="fld fld--check"><input data-f="enabled" type="checkbox"' + (enabled ? " checked" : "") + " /> <span>Enabled (included in runs)</span></label>";
    var actions = isNew
      ? '<button type="button" class="btn btn--primary setup-create">Add project</button>' +
        '<button type="button" class="btn setup-cancel">Cancel</button>'
      : '<button type="button" class="btn btn--primary setup-save">Save</button>' +
        '<button type="button" class="btn setup-smoke" title="Copy an MCP smoke-test prompt">Smoke test</button>' +
        '<button type="button" class="btn setup-delete">Delete</button>';
    return (
      '<div class="cfrm__grid">' + fields + regionSel + industrySel + enabledChk + "</div>" +
      '<div class="cfrm__actions">' + actions + '<span class="cfrm__status"></span></div>'
    );
  }

  function renderSetup(root, data) {
    if (!APP.serverMode) {
      root.appendChild(
        el(
          '<div class="banner banner--info">\u2139\uFE0F <span>Setup editing needs the local server. ' +
            'Run <code>serve.command</code> (or <code>uv run --with ruamel.yaml serve.py</code>) and open ' +
            "<code>http://127.0.0.1:8787</code>. Below is your current configuration (read-only).</span></div>"
        )
      );
      root.appendChild(setupReadOnly(data));
      return;
    }

    root.appendChild(
      el(
        '<div class="setupintro"><h2>Routing registry</h2>' +
          "<p>Add, edit, or remove the projects the skill monitors. This writes only the local, gitignored " +
          "<code>clients.yml</code> (routing only \u2014 never secrets).</p></div>"
      )
    );

    var listWrap = el('<div class="clientlist"></div>');
    (APP.state.clients || []).forEach(function (c) {
      var card = el(
        '<section class="cfrm" data-name="' + esc(c.name) + '">' +
          '<header class="cfrm__head"><span class="cfrm__title">' + esc(c.name) + "</span>" +
            (c.enabled === false ? '<span class="pill pill--muted">disabled</span>' : "") +
          "</header>" +
          '<div class="cfrm__body">' + clientFormHtml(c, false) + "</div>" +
        "</section>"
      );
      listWrap.appendChild(card);
    });
    if (!(APP.state.clients || []).length) {
      listWrap.appendChild(el('<div class="proj__empty">No projects yet \u2014 add your first one below.</div>'));
    }
    root.appendChild(listWrap);

    root.appendChild(
      el(
        '<div class="addwrap">' +
          '<button type="button" class="btn btn--primary" id="addClientBtn">+ Add project</button>' +
          '<section class="cfrm cfrm--new" id="newClient" hidden>' +
            '<header class="cfrm__head"><span class="cfrm__title">New project</span></header>' +
            '<div class="cfrm__body">' + clientFormHtml({}, true) + "</div>" +
          "</section>" +
        "</div>"
      )
    );

    root.appendChild(credsPanel());
  }

  function registryRows(data) {
    var rows = [];
    (data.clients || []).forEach(function (c) {
      (c.projects || []).forEach(function (p) {
        var ind = projIndustry(p);
        rows.push(
          "<tr>" +
            '<td class="reg__name">' + esc(p.name) + "</td>" +
            "<td>" + (ind ? esc(verticalLabel(ind)) : '<span class="reg__muted">all_verticals</span>') + "</td>" +
            "<td>" + (p.channel ? "#" + esc(p.channel) : '<span class="reg__muted">\u2014</span>') + "</td>" +
          "</tr>"
        );
      });
    });
    return rows.join("");
  }
  function setupReadOnly(data) {
    var setup = data.setup || {};
    var rows = registryRows(data);
    var registry = rows
      ? '<div class="panel"><h3>Routing registry</h3>' +
          '<p class="note">Industry per project (from your local <code>clients.yml</code>). ' +
          "Editing needs the local server \u2014 see the banner above.</p>" +
          '<table class="regtable"><thead><tr><th>Project</th><th>Industry</th><th>Slack</th></tr></thead>' +
          "<tbody>" + rows + "</tbody></table></div>"
      : "";
    var files = (setup.files || [])
      .map(function (f) {
        return (
          '<div class="fileitem"><div class="lbl">' + esc(f.label) + "</div>" +
            "<code>" + esc(f.path) + "</code>" +
            (f.note ? '<div class="note">' + esc(f.note) + "</div>" : "") +
          "</div>"
        );
      })
      .join("");
    var todos = (setup.checklist || [])
      .map(function (t) {
        return (
          '<li class="' + (t.done ? "done" : "") + '">' +
            '<span class="mark ' + (t.done ? "mark--done" : "mark--todo") + '">' + (t.done ? "\u2713" : "") + "</span>" +
            esc(t.content) +
          "</li>"
        );
      })
      .join("");
    var hasContent = registry || files || todos;
    return el(
      '<div class="setup__grid">' +
        registry +
        (files ? '<div class="panel"><h3>Local file locations</h3>' + files + "</div>" : "") +
        (todos ? '<div class="panel"><h3>Install checklist</h3><ul class="todo">' + todos + "</ul></div>" : "") +
        (!hasContent ? '<div class="panel"><div class="note">No setup details available.</div></div>' : "") +
      "</div>"
    );
  }

  function credsPanel() {
    return el(
      '<section class="panel creds">' +
        "<h3>Credentials &amp; connection test</h3>" +
        '<p class="note">Secrets are never handled by this page. Airship OAuth credentials live only in ' +
          "<code>~/.cursor/mcp.json</code> (one Airship MCP server per project). Use the prompts below " +
          "in Cursor chat \u2014 the agent does the secret setup and the MCP smoke-tests.</p>" +
        '<div class="creds__btns">' +
          '<button type="button" class="btn" id="credSetup">Copy: guided credential setup</button>' +
          '<button type="button" class="btn" id="credSmokeAll">Copy: smoke-test all projects</button>' +
        "</div>" +
      "</section>"
    );
  }

  function readClientForm(card) {
    var out = {};
    card.querySelectorAll("[data-f]").forEach(function (inp) {
      var f = inp.getAttribute("data-f");
      if (inp.type === "checkbox") out[f] = inp.checked;
      else out[f] = inp.value.trim();
    });
    return out;
  }

  function wireSetup(root) {
    var addBtn = root.querySelector("#addClientBtn");
    var newCard = root.querySelector("#newClient");
    if (addBtn && newCard) {
      addBtn.addEventListener("click", function () {
        newCard.hidden = !newCard.hidden;
        if (!newCard.hidden) { var f = newCard.querySelector("input[data-f=name]"); if (f) f.focus(); }
      });
      var cancel = newCard.querySelector(".setup-cancel");
      if (cancel) cancel.addEventListener("click", function () { newCard.hidden = true; });
      var create = newCard.querySelector(".setup-create");
      if (create) create.addEventListener("click", function () {
        var st = newCard.querySelector(".cfrm__status");
        var body = readClientForm(newCard);
        if (!body.name) { st.style.color = "var(--danger)"; st.textContent = "Project name is required."; return; }
        st.style.color = ""; st.textContent = "Saving\u2026";
        api("/api/client", body).then(function () { rerender(); setActiveView(document.getElementById("app"), "setup"); toast("Added " + body.name); })
          .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
      });
    }

    root.querySelectorAll(".cfrm[data-name]").forEach(function (card) {
      var orig = card.getAttribute("data-name");
      var st = card.querySelector(".cfrm__status");
      var save = card.querySelector(".setup-save");
      if (save) save.addEventListener("click", function () {
        var body = readClientForm(card);
        body.oldName = orig;
        if (!body.name) { st.style.color = "var(--danger)"; st.textContent = "Project name is required."; return; }
        st.style.color = ""; st.textContent = "Saving\u2026";
        api("/api/client", body).then(function () { rerender(); setActiveView(document.getElementById("app"), "setup"); toast("Saved " + body.name); })
          .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
      });
      var del = card.querySelector(".setup-delete");
      if (del) del.addEventListener("click", function () {
        if (!window.confirm('Delete "' + orig + '" from clients.yml? (Credentials in mcp.json are not touched.)')) return;
        api("/api/client/delete", { name: orig }).then(function () { rerender(); setActiveView(document.getElementById("app"), "setup"); toast("Deleted " + orig); })
          .catch(function (e) { st.style.color = "var(--danger)"; st.textContent = "Error: " + e.message; });
      });
      var smoke = card.querySelector(".setup-smoke");
      if (smoke) smoke.addEventListener("click", function () {
        var body = readClientForm(card);
        var mcp = body.airship_mcp || "<MCP server name>";
        copyModal("Smoke test \u2014 paste into chat",
          'Using MCP server "' + mcp + '", call call_airship_api: GET /api/reports/opens (expect status_code: 200)');
      });
    });

    var credSetup = root.querySelector("#credSetup");
    if (credSetup) credSetup.addEventListener("click", function () {
      copyModal("Guided setup \u2014 paste into chat",
        "Set up the airship-kpi-monitor skill for me: read SETUP.md and walk me through the credential steps " +
        "(add each project's Airship MCP server to ~/.cursor/mcp.json) and the MCP smoke-tests. " +
        "I'll manage the routing (projects, channels, thresholds, mutes) from the local dashboard.");
    });
    var credSmokeAll = root.querySelector("#credSmokeAll");
    if (credSmokeAll) credSmokeAll.addEventListener("click", function () {
      copyModal("Smoke-test all \u2014 paste into chat",
        "For every project in clients.yml, run a quick airship-kpi-monitor connectivity check: " +
        "call call_airship_api GET /api/reports/opens on each project's Airship MCP server and report any non-200.");
    });
  }

  // --- interactivity ---------------------------------------------------------
  function wireUp(root, data) {
    // theme toggle (persisted locally)
    var themeBtn = root.querySelector("#themeBtn");
    try {
      var saved = localStorage.getItem("kpi-theme");
      if (saved) document.documentElement.setAttribute("data-theme", saved);
    } catch (e) {}
    themeBtn.addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", cur);
      try { localStorage.setItem("kpi-theme", cur); } catch (e) {}
    });

    // Nav tabs are plain <a href="#/…"> links — the hashchange listener re-renders.

    // Clickable project rows (fleet list → deep project page). Inner links/buttons
    // marked data-nonav (channel, Canvas) keep their own behaviour.
    root.querySelectorAll(".proj--link").forEach(function (row) {
      function go() { navTo("#/project/" + encodeURIComponent(row.getAttribute("data-project"))); }
      row.addEventListener("click", function (e) {
        if (e.target.closest("[data-nonav]")) return;
        go();
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
      });
    });

    // "Needs attention" rows scroll to the KPI card they name. The card is flashed
    // briefly, because on a long panel a silent scroll leaves the reader hunting
    // for which of the cards now in view was the one they asked for.
    root.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () {
        var target = document.getElementById(b.getAttribute("data-goto"));
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("kcard--flash");
        void target.offsetWidth; // restart the animation if the same row is clicked twice
        target.classList.add("kcard--flash");
        setTimeout(function () { target.classList.remove("kcard--flash"); }, 1800);
      });
    });

    // Onboarding: copy the "run the skill" prompt from the sample-data banner.
    var runBtn = root.querySelector("#runPromptBtn");
    if (runBtn) runBtn.addEventListener("click", function () {
      copyModal("Run the skill \u2014 paste into chat", runPrompt());
    });

    // Orphan-suggestion table (thresholdsPanel): Apply / Reset.
    root.querySelectorAll(".th-apply").forEach(function (b) {
      b.addEventListener("click", function () { applySuggestion(b.getAttribute("data-project"), b.getAttribute("data-key"), b.getAttribute("data-val")); });
    });
    root.querySelectorAll(".th-reset").forEach(function (b) {
      b.addEventListener("click", function () { resetThreshold(b.getAttribute("data-project"), b.getAttribute("data-key")); });
    });

    // Inline per-KPI threshold editing (on each KPI card): Set / Reset / Apply.
    root.querySelectorAll(".kthr-set").forEach(function (b) {
      b.addEventListener("click", function () { inlineThresholdSave(b.closest(".kthr")); });
    });
    root.querySelectorAll(".kthr-reset").forEach(function (b) {
      b.addEventListener("click", function () {
        var box = b.closest(".kthr");
        resetThreshold(box.getAttribute("data-project"), box.getAttribute("data-key"));
      });
    });
    root.querySelectorAll(".kthr-apply").forEach(function (b) {
      b.addEventListener("click", function () { applySuggestion(b.getAttribute("data-project"), b.getAttribute("data-key"), b.getAttribute("data-val")); });
    });
    // Dismiss a threshold suggestion (inline card + orphan table).
    root.querySelectorAll(".kthr-dismiss, .th-dismiss").forEach(function (b) {
      b.addEventListener("click", function () { dismissSuggestion(b.getAttribute("data-project"), b.getAttribute("data-key")); });
    });
    // Click-to-expand the tile sparkline into a large interactive chart.
    root.querySelectorAll(".kcard__spark-expand").forEach(function (b) {
      b.addEventListener("click", function () {
        var raw = b.getAttribute("data-series");
        var series;
        try { series = JSON.parse(decodeURIComponent(raw)); } catch (e) { series = null; }
        if (series && series.length) openChart(b.getAttribute("data-label") || "History", b.getAttribute("data-unit") || "", series);
      });
    });
    // Enter in an inline threshold input commits the change.
    root.querySelectorAll(".kthr__input").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); inlineThresholdSave(inp.closest(".kthr")); }
      });
    });

    // collapse/expand a card
    root.querySelectorAll(".card__head").forEach(function (h) {
      h.addEventListener("click", function () {
        h.parentElement.classList.toggle("collapsed");
      });
    });

    // collapse/expand all
    var toggleAll = root.querySelector("#toggleAll");
    if (toggleAll) toggleAll.addEventListener("click", function () {
      var cards = root.querySelectorAll("#cards .card");
      var anyOpen = Array.prototype.some.call(cards, function (c) { return !c.classList.contains("collapsed"); });
      cards.forEach(function (c) { c.classList.toggle("collapsed", anyOpen); });
      toggleAll.textContent = anyOpen ? "Expand all" : "Collapse all";
    });

    // search + severity filter
    var q = root.querySelector("#q");
    var activeSev = {};
    var chips = root.querySelectorAll(".chip");
    function applyFilter() {
      var term = (q.value || "").trim().toLowerCase();
      var sevs = Object.keys(activeSev).filter(function (k) { return activeSev[k]; });
      root.querySelectorAll("#cards .card").forEach(function (card) {
        var visibleRows = 0;
        card.querySelectorAll(".proj").forEach(function (block) {
          var matchTerm = !term || (block.getAttribute("data-hay") || "").indexOf(term) !== -1;
          var matchSev = !sevs.length || sevs.indexOf(block.getAttribute("data-sev")) !== -1;
          var show = matchTerm && matchSev;
          block.style.display = show ? "" : "none";
          if (show) visibleRows++;
        });
        card.style.display = visibleRows ? "" : "none";
        if (visibleRows && (term || sevs.length)) card.classList.remove("collapsed");
      });
    }
    if (q) q.addEventListener("input", applyFilter);
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var s = chip.getAttribute("data-sev");
        activeSev[s] = !activeSev[s];
        chip.setAttribute("aria-pressed", activeSev[s] ? "true" : "false");
        applyFilter();
      });
    });

    // Mute / Unmute
    root.querySelectorAll(".mutebtn").forEach(function (b) {
      b.addEventListener("click", function () {
        var action = b.getAttribute("data-action");
        var project = b.getAttribute("data-project");
        var key = b.getAttribute("data-key");
        var reason = b.getAttribute("data-reason");
        if (action === "unmute") onUnmute(project, key);
        else if (action === "dismiss-alert") onDismissAlert(project, key, b.getAttribute("data-opened"));
        else if (action === "undismiss-alert") onUndismissAlert(project, key);
        else onMute(project, key, reason);
      });
    });

    // Context (a standing note on a KPI, kept in clients.yml across runs)
    root.querySelectorAll(".ctxchip").forEach(function (b) {
      b.addEventListener("click", function () {
        onContext(b.getAttribute("data-project"), b.getAttribute("data-key"));
      });
    });

    // Thresholds
    root.querySelectorAll(".thbtn").forEach(function (b) {
      b.addEventListener("click", function () { openThresholds(b.getAttribute("data-project")); });
    });

    // Industry (benchmark vertical)
    root.querySelectorAll(".indbtn").forEach(function (b) {
      b.addEventListener("click", function () { onIndustry(b.getAttribute("data-project"), b.getAttribute("data-industry")); });
    });

    // Setup view
    wireSetup(root);
  }

  // --- boot ------------------------------------------------------------------
  function start() {
    var root = document.getElementById("app");
    var data = window.AIRSHIP_KPI_DATA;
    if (!data) {
      root.innerHTML =
        '<div class="empty">No data found. Run the airship-kpi-monitor skill to generate ' +
        "<code>dashboard-data.js</code>, or check that <code>dashboard-data.sample.js</code> is present.</div>";
      return;
    }
    data.slackWorkspace = data.slackWorkspace || DEFAULTS.slackWorkspace;
    data.slackTeamId = data.slackTeamId || DEFAULTS.slackTeamId;
    APP.data = data;
    window.addEventListener("hashchange", function () { render(document.getElementById("app")); });
    probe().then(function () {
      // server state may override workspace/team for deep links
      if (APP.state) {
        if (APP.state.slackWorkspace) data.slackWorkspace = APP.state.slackWorkspace;
        if (APP.state.slackTeamId) data.slackTeamId = APP.state.slackTeamId;
      }
      render(root);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
