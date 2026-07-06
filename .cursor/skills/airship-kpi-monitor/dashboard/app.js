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
    { id: "custom", label: "Custom events" },
    { id: "devices", label: "Devices" },
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
  // Trend cell: a plain string renders as text; an array renders as bullets
  // (used for watch/alert projects so each driver gets its own line).
  function trendCell(trend) {
    if (Array.isArray(trend)) {
      var items = trend.filter(function (t) { return t != null && String(t).trim() !== ""; });
      if (!items.length) return "\u2014";
      return '<ul class="trend-list">' + items.map(function (t) {
        return "<li>" + esc(t) + "</li>";
      }).join("") + "</ul>";
    }
    return esc(trend || "\u2014");
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
  function routeHash(route) {
    if (!route || route.name === "list") return "#/";
    if (route.name === "setup") return "#/setup";
    if (route.name === "project") return "#/project/" + encodeURIComponent(route.project);
    return "#/";
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
  function fmtSigned(n) {
    var v = Number(n);
    if (isNaN(v)) return "\u2014";
    return (v > 0 ? "+" : "") + fmt1(v);
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
  // Value formatting driven by the metric's own unit (the unit of current/previous).
  function fmtVal(v, unit) {
    if (v == null || isNaN(v)) return "\u2014";
    if (unit === "%") return fmt1(v) + "%";
    if (unit === "pts") return fmt1(v) + " pts";
    if (unit === "min") return fmt1(v) + " min";
    return fmtCount(v);
  }
  // WoW delta chip. Points (deltaPts) for rate metrics, percent (deltaPct) else.
  function deltaChip(m) {
    var v, u;
    if (typeof m.deltaPts === "number") { v = m.deltaPts; u = " pts"; }
    else if (typeof m.deltaPct === "number") { v = m.deltaPct; u = "%"; }
    else return "";
    var dir = v > 0 ? "up" : v < 0 ? "down" : "flat";
    var arrow = v > 0 ? "\u25B2" : v < 0 ? "\u25BC" : "\u2013";
    return '<span class="delta delta--' + dir + '">' + arrow + " " + fmt1(Math.abs(v)) + u + "</span>";
  }
  var MSTATUS = {
    ok: { t: "OK", c: "ok" },
    candidate: { t: "Watching", c: "cand" },
    confirmed: { t: "Confirmed", c: "danger" },
    muted: { t: "Muted", c: "muted" },
    na: { t: "n/a", c: "na" },
  };
  function metricStatus(m) {
    var s = m.status;
    if (!s) s = m.threshold && m.threshold.breaching ? "confirmed" : "ok";
    return MSTATUS[s] || MSTATUS.ok;
  }
  function statusChip(m) {
    var i = metricStatus(m);
    return '<span class="mstatus mstatus--' + i.c + '">' + esc(i.t) + "</span>";
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
    var u = unit === "pts" ? " pts" : unit === "%" ? "%" : "";
    var cap = t.breaching
      ? "Breaching by " + fmtSigned(-H) + u + " \u00B7 threshold " + fmt1(t.value) + u
      : "Headroom " + fmt1(H) + u + " \u00B7 threshold " + fmt1(t.value) + u + (t.kind ? " (" + esc(t.kind) + ")" : "");
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
  // The metric closest to breaching (smallest headroom) — the project's weakest point.
  function worstHeadroomMetric(p) {
    var ms = (p.metrics || []).filter(function (m) { return m && m.threshold && typeof m.threshold.headroom === "number"; });
    if (!ms.length) return null;
    ms.sort(function (a, b) { return a.threshold.headroom - b.threshold.headroom; });
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
  // Find a project's live routing entry in the server state (by name/brand).
  function stateClient(name) {
    if (!APP.state || !APP.state.clients) return null;
    var t = String(name || "").trim().toLowerCase();
    for (var i = 0; i < APP.state.clients.length; i++) {
      var c = APP.state.clients[i];
      if (String(c.name || "").toLowerCase() === t || String(c.brand_name || "").toLowerCase() === t) return c;
    }
    return null;
  }
  function serverOverrides(project) {
    var c = stateClient(project);
    return (c && c.custom_thresholds) || {};
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
  // Returns the age affordance for an alert.
  // Always returns at least an empty <span class="age"> so that subgrid column 4
  // is always occupied — this keeps the Mute button in column 5 on every row.
  function ageAffordance(a, runStr) {
    var openedAt = a.openedAt || a.opened || null;
    if (openedAt) {
      var days = alertAgeDays(openedAt, runStr);
      if (days != null) {
        if (days >= 1) return ageGraph(openedAt, runStr, a.severity || "info");
        return newChip();
      }
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
              (data.window ? '<span class="sep">\u2022</span>Window ' + esc(data.window) : "") +
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
          (st.muted > 0 ? stat(st.muted, "Muted (false positives)", "muted") : "") +
        "</section>"
      )
    );

    if (data.priority && !data.isSample) {
      root.appendChild(
        el(
          '<div class="callout"><span class="callout__icon">\uD83D\uDCCC</span><div>' +
            '<div class="callout__title">Priority focus</div>' + esc(data.priority) +
          "</div></div>"
        )
      );
    }

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

  function clientAlerts(c) {
    return (c.projects || []).reduce(function (s, p) {
      return s + projAlerts(p).count;
    }, 0);
  }

  // Per-alert detail with a Mute / Unmute action on each key. `runStr` is the
  // current run timestamp, used to graph how long each alert has been open.
  function alertsDetail(project, list, runStr) {
    if (!list || !list.length) return "";
    var items = list
      .map(function (a) {
        var sev = a.severity && SEV[a.severity] ? a.severity : "info";
        var muted = !!a.muted;
        var label = muted
          ? '<span class="mutedpill">\uD83D\uDD15 Muted</span>'
          : '<span class="dot dot--' + sev + '" title="' + esc(SEV[sev].label) + '"></span>';
        var reason = muted && a.reason ? '<span class="alert__reason">' + esc(a.reason) + "</span>" : "";
        var age = ageAffordance(a, runStr);
        var btn =
          '<button class="mutebtn' + (muted ? " mutebtn--unmute" : "") + '" type="button"' +
          ' data-action="' + (muted ? "unmute" : "mute") + '"' +
          ' data-project="' + esc(project) + '" data-key="' + esc(a.key) + '"' +
          ' data-reason="' + esc(a.reason || "") + '">' +
          (muted ? "Unmute" : "Mute") + "</button>";
        return (
          '<li class="alert' + (muted ? " alert--muted" : "") + '">' +
            label +
            '<code class="alert__key">' + esc(a.key) + "</code>" +
            (a.cause && !muted ? '<span class="alert__cause">' + esc(a.cause) + "</span>" : "") +
            reason +
            age +
            btn +
          "</li>"
        );
      })
      .join("");
    return '<ul class="alerts">' + items + "</ul>";
  }

  // Candidate breaches: breaching but not yet confirmed (Step 8a). They live only
  // in the dashboard — never posted to Slack — with a streak chip (x/N runs).
  function candidatesDetail(list) {
    if (!list || !list.length) return "";
    var items = list
      .map(function (a) {
        var sev = a.severity && SEV[a.severity] ? a.severity : "info";
        var streak = a.streak != null && a.needed != null ? a.streak + "/" + a.needed : a.streak != null ? String(a.streak) : "\u2022";
        return (
          '<li class="cand cand--' + sev + '">' +
            '<span class="cand__streak" title="Consecutive breaching runs / runs needed to confirm">' + esc(streak) + "</span>" +
            '<code class="alert__key">' + esc(a.key) + "</code>" +
            (a.cause ? '<span class="alert__cause">' + esc(a.cause) + "</span>" : "") +
          "</li>"
        );
      })
      .join("");
    return '<ul class="cands">' + items + "</ul>";
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
    var sev = pa.worst;
    var cands = (p.candidatesList || []).filter(function (a) { return a && a.key; });

    var badges = "";
    if (pa.count > 0 && sev) {
      badges += '<span class="pill ' + SEV[sev].pill + '">' + pa.count + " " + SEV[sev].label + "</span>";
    } else if (pa.mutedCount === 0 && !cands.length) {
      badges += '<span class="pill pill--ok">\u2713 OK</span>';
    }
    if (cands.length > 0) {
      badges += '<span class="pill pill--cand">\uD83D\uDD0E ' + cands.length + " watching</span>";
    }
    if (pa.mutedCount > 0) {
      badges += '<span class="pill pill--muted">\uD83D\uDD15 ' + pa.mutedCount + " muted</span>";
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

  function clientCard(data, c) {
    var projects = (c.projects || []).slice().sort(function (a, b) {
      return projAlerts(b).count - projAlerts(a).count ||
        String(a.name).localeCompare(String(b.name));
    });
    var nAlerts = clientAlerts(c);
    var meta = nAlerts > 0
      ? nAlerts + " open alert" + (nAlerts > 1 ? "s" : "") + " \u00B7 " + projects.length + " project" + (projects.length > 1 ? "s" : "")
      : projects.length + " project" + (projects.length > 1 ? "s" : "") + " \u00B7 stable";

    var blocks = projects.map(function (p) { return projectBlock(data, c, p); }).join("");

    return el(
      '<section class="card" data-client="' + esc((c.name || "").toLowerCase()) + '">' +
        '<button class="card__head" type="button">' +
          '<span class="card__caret">\u25BC</span>' +
          '<span class="card__name">' + esc(c.name) + "</span>" +
          '<span class="card__meta">' + esc(meta) + "</span>" +
        "</button>" +
        '<div class="card__body">' + blocks + "</div>" +
      "</section>"
    );
  }

  // Group all projects by their Slack channel, merging clients that share a channel
  // into a single fleet-list card (e.g. GMF + MAAF + MMA → cs_fr_covea).
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
    var sev = pa.worst;
    var cands = (p.candidatesList || []).filter(function (a) { return a && a.key; });
    var resolved = (data.resolvedRecently || []).filter(function (r) {
      return String(r.project || "").trim().toLowerCase() === String(p.name).trim().toLowerCase();
    });

    root.appendChild(breadcrumb(esc(p.name)));

    // Header
    var sevPill = pa.count > 0 && sev
      ? '<span class="pill ' + SEV[sev].pill + '">' + pa.count + " " + SEV[sev].label + "</span>"
      : (cands.length ? '<span class="pill pill--cand">\uD83D\uDD0E ' + cands.length + " watching</span>" : '<span class="pill pill--ok">\u2713 Stable</span>');
    var ind = projIndustry(p);
    var indBtn = '<button class="linkbtn indbtn" type="button" data-project="' + esc(p.name) + '" data-industry="' + esc(ind) +
      '" title="Industry vertical for benchmark comparison">\uD83C\uDFF7\uFE0F ' + (ind ? esc(verticalLabel(ind)) : "Set industry") + "</button>";
    var canvas = p.canvasId ? '<a class="linkbtn" href="' + esc(canvasLink(data, p.canvasId)) + '">\uD83D\uDCCA Canvas</a>' : "";
    var thr = '<button class="linkbtn thbtn" type="button" data-project="' + esc(p.name) + '">\u2699 Edit thresholds</button>';
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
          '<div class="phead__actions">' + indBtn + thr + canvas + "</div>" +
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

    // At-a-glance tiles
    var wh = worstHeadroomMetric(p);
    var whTxt = wh ? (wh.threshold.breaching ? "breaching" : fmt1(wh.threshold.headroom) + (thresholdUnit(wh.threshold) === "pts" ? " pts" : thresholdUnit(wh.threshold) === "%" ? "%" : "")) : "\u2014";
    root.appendChild(
      el(
        '<section class="glance">' +
          stat(pa.count, "Open alerts", pa.count > 0 ? "danger" : "") +
          stat(cands.length, "Watching", cands.length > 0 ? "warning" : "") +
          stat(pa.mutedCount, "Muted", pa.mutedCount > 0 ? "muted" : "") +
          stat(resolved.length, "Resolved recently", resolved.length > 0 ? "success" : "") +
          '<div class="stat stat--wide' + (wh && wh.threshold.breaching ? " stat--danger" : "") + '">' +
            '<div class="stat__value">' + esc(whTxt) + "</div>" +
            '<div class="stat__label">Worst headroom' + (wh ? " \u00B7 " + esc(wh.label) : "") + "</div>" +
          "</div>" +
        "</section>"
      )
    );

    // KPI panels by channel
    root.appendChild(kpiPanels(p));

    // Alerts & timeline
    root.appendChild(alertsTimeline(data, p, pa, cands, resolved));

    // Thresholds & suggestions
    root.appendChild(thresholdsPanel(p));
  }

  function kpiPanels(p) {
    var wrap = el('<div class="psection"><h3 class="psection__title">KPI depth</h3><div class="kpanels"></div></div>');
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
      var cards = list.map(kpiCard).join("");
      host.appendChild(
        el('<section class="kpanel"><header class="kpanel__head">' + esc(grp.label) + "</header>" +
          '<div class="kpanel__cards">' + cards + "</div></section>")
      );
    });
    return wrap;
  }

  // Per-KPI provenance: which Airship Reports API endpoint feeds the metric and
  // exactly how it is computed. Keyed by metric family (base key without the
  // _ios/_android/_web OS suffix) so it works retroactively on old snapshots
  // without re-running the skill. Mirrors SKILL.md "Data sources" table.
  var KPI_META = {
    app_opens: { src: "/api/reports/opens", calc: "\u03A3 daily app opens over the 7-day window, per OS (raw count). WoW \u0394% = (current \u2212 previous) \u00F7 previous \u00D7 100." },
    timeinapp: { src: "/api/reports/timeinapp", calc: "Average time-in-app per day (Airship value), per OS. WoW \u0394% vs the previous 7-day window." },
    push_sends: { src: "/api/reports/sends", calc: "\u03A3 push notifications sent over 7 days, per OS (raw count). WoW \u0394% vs previous 7 days." },
    optouts: { src: "/api/reports/optouts \u00F7 /api/reports/sends", calc: "\u03A3 push opt-outs over 7 days, per OS. Two signals: RAW COUNT (WoW \u0394%) and the per-send RATE = opt-outs \u00F7 push sends \u00D7 100. The alert fires only when BOTH the raw count rises \u2265 optouts_rise_pct AND the rate worsens \u2265 optout_rate_rise_pct \u2014 so a volume-driven rise (rate flat/down while sends grow) is suppressed." },
    optins: { src: "/api/reports/optins", calc: "\u03A3 NEW push opt-ins over 7 days, per OS (raw count). WoW \u0394% vs previous 7 days. Distinct from opt-in RATE (opted-in \u00F7 unique devices, from /devices)." },
    direct_response_rate: { src: "/api/reports/responses", calc: "Click rate = direct responses (push clicks) \u00F7 push sends \u00D7 100, per OS, over the 7-day window. WoW \u0394 in percentage points. Tracking-health signal." },
    devices_unique: { src: "/api/reports/devices", calc: "Unique-devices snapshot, per OS. \u0394% vs the canvas D-7 snapshot." },
    devices_optin: { src: "/api/reports/devices", calc: "Opted-in devices snapshot, per OS. \u0394% vs the canvas D-7 snapshot. This is the opt-in BASE, not new opt-ins." },
    devices_uninstall: { src: "/api/reports/devices", calc: "Uninstalled-devices snapshot, per OS. \u0394% vs the canvas D-7 snapshot." },
    email_sends: { src: "/api/reports/sends", calc: "\u03A3 emails sent over 7 days (field `email`). WoW \u0394% vs previous 7 days." },
    email_deliverability: { src: "/api/reports/events", calc: "Delivered \u00F7 injected \u00D7 100 over the window (absolute rate)." },
    email_open_rate: { src: "/api/reports/events", calc: "Deduplicated opens (`initial_open`) \u00F7 delivered \u00D7 100. WoW \u0394 in percentage points." },
    email_bounce: { src: "/api/reports/events", calc: "Bounces \u00F7 injected \u00D7 100 over the window (absolute rate)." },
    email_spam_complaint_rate: { src: "/api/reports/events", calc: "Daily spam_complaint \u00F7 delivery \u00D7 100 (precision=DAILY)." },
    email_delay_rate: { src: "/api/reports/events", calc: "Hourly delay \u00F7 delivery \u00D7 100 (precision=HOURLY), confirmed over \u2265 N consecutive hours." },
    web_sends: { src: "/api/reports/sends", calc: "\u03A3 web-push sends over 7 days (field `web`). WoW \u0394% vs previous 7 days." },
    sms_sends: { src: "/api/reports/sends", calc: "\u03A3 SMS sends over 7 days (field `sms`). WoW \u0394% vs previous 7 days." },
    sms_delivery_rate: { src: "/api/reports/events", calc: "Delivered \u00F7 dispatched \u00D7 100 (SMS delivery-report events)." },
    custom_event: { src: "/api/reports/events", calc: "\u03A3 custom-event count over 7 days. WoW \u0394% vs previous 7 days." },
  };
  // Resolve the provenance entry for a metric key by longest matching family.
  function kpiMeta(key) {
    var k = String(key || "");
    var best = null;
    Object.keys(KPI_META).forEach(function (fam) {
      if (k === fam || k.indexOf(fam + "_") === 0) {
        if (!best || fam.length > best.length) best = fam;
      }
    });
    return best ? KPI_META[best] : null;
  }

  function kpiCard(m) {
    var t = m.threshold || {};
    var osHtml = "";
    if (m.os && (m.os.ios || m.os.android)) {
      var parts = [];
      if (m.os.ios && typeof m.os.ios.deltaPct === "number") parts.push('<span class="os">iOS ' + deltaChip({ deltaPct: m.os.ios.deltaPct }) + "</span>");
      if (m.os.android && typeof m.os.android.deltaPct === "number") parts.push('<span class="os">Android ' + deltaChip({ deltaPct: m.os.android.deltaPct }) + "</span>");
      if (parts.length) osHtml = '<div class="kcard__os">' + parts.join("") + "</div>";
    }
    var series = (m.series || []).map(function (s) { return typeof s === "object" ? s.v : s; });
    var sparkHtml = series.length >= 2 ? '<div class="kcard__spark">' + lineSparkline(series, 150, 30) + "</div>" : "";
    // Opt-out (and any rate-correlated) metrics carry a `rate` object so the raw
    // count is read alongside the per-send rate that actually drives the alert.
    var rateHtml = "";
    if (m.rate) {
      var r = m.rate;
      if (typeof r.current === "number") {
        var dir = typeof r.deltaPct === "number"
          ? (r.deltaPct > 0 ? "up" : r.deltaPct < 0 ? "down" : "flat")
          : "flat";
        var arrow = dir === "up" ? "\u25B2" : dir === "down" ? "\u25BC" : "\u25AC";
        var deltaTxt = typeof r.deltaPct === "number" ? " (" + arrow + " " + Math.abs(r.deltaPct).toFixed(1) + "% WoW)" : "";
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
    var meta = kpiMeta(m.key);
    var metaHtml = meta
      ? '<details class="kcard__meta"><summary>Source &amp; calc</summary>' +
          '<div class="kcard__src">Source <code>' + esc(meta.src) + "</code></div>" +
          '<div class="kcard__calc">' + esc(meta.calc) + "</div>" +
        "</details>"
      : "";
    return (
      '<article class="kcard kcard--' + metricStatus(m).c + '">' +
        '<div class="kcard__top">' +
          '<div class="kcard__ident"><span class="kcard__label">' + esc(m.label || m.key) + "</span>" +
            '<code class="kcard__key">' + esc(m.key) + "</code></div>" +
          statusChip(m) +
        "</div>" +
        '<div class="kcard__vals">' +
          '<span class="kcard__cur">' + fmtVal(m.current, m.unit) + "</span>" +
          '<span class="kcard__prev">prev ' + fmtVal(m.previous, m.unit) + "</span>" +
          '<span class="kcard__wow">WoW ' + deltaChip(m) + "</span>" +
        "</div>" +
        rateHtml +
        noteHtml +
        osHtml +
        sparkHtml +
        headroomGauge(t, thresholdUnit(t)) +
        metaHtml +
      "</article>"
    );
  }

  function alertsTimeline(data, p, pa, cands, resolved) {
    var wrap = el('<div class="psection"><h3 class="psection__title">Alerts &amp; timeline</h3><div class="panel ptimeline"></div></div>');
    var host = wrap.querySelector(".ptimeline");
    var alertsHtml = pa.list && pa.list.length
      ? alertsDetail(p.name, pa.list, data.generatedAt)
      : '<div class="proj__empty">\u2713 No confirmed alerts</div>';
    host.appendChild(el('<div class="tblock"><div class="proj__label">Confirmed alerts</div>' + alertsHtml + "</div>"));
    if (cands.length) {
      host.appendChild(el('<div class="tblock"><div class="proj__label">\uD83D\uDD0E Watching \u00B7 not yet confirmed</div>' + candidatesDetail(cands) + "</div>"));
    }
    if (resolved.length) {
      var rows = resolved.map(function (r) {
        return '<li class="resolved"><span class="resolved__mark">\u2713</span>' +
          '<code class="alert__key">' + esc(r.key) + "</code>" +
          (r.resolvedAt ? '<span class="resolved__when">' + esc(r.resolvedAt) + "</span>" : "") +
          (r.cause ? '<span class="alert__cause">' + esc(r.cause) + "</span>" : "") + "</li>";
      }).join("");
      host.appendChild(el('<div class="tblock"><div class="proj__label">\u2705 Recently resolved</div><ul class="resolvedlist">' + rows + "</ul></div>"));
    }
    return wrap;
  }

  // Thresholds & suggestions panel: effective value, skill suggestion + rationale
  // + confidence, and Apply / Edit / Reset actions.
  function thresholdsPanel(p) {
    var suggestions = (p.thresholdSuggestions || []).filter(function (s) { return s && s.key; });
    var overrides = serverOverrides(p.name);
    var wrap = el('<div class="psection"><h3 class="psection__title">Thresholds &amp; suggestions</h3><div class="panel thpanel"></div></div>');
    var host = wrap.querySelector(".thpanel");

    var intro = APP.serverMode
      ? "Suggestions are computed by the skill from this project\u2019s observed volatility, muted/resolved false positives and chronic headroom. Apply writes your local clients.yml."
      : "Suggestions are computed by the skill. Start the local server to apply them in one click \u2014 otherwise Apply/Reset copy a prompt for Cursor chat.";
    host.appendChild(el('<p class="note">' + esc(intro) + '</p>'));

    if (!suggestions.length) {
      host.appendChild(el('<div class="thempty">\u2713 No threshold adjustments suggested \u2014 current thresholds look well-tuned for this project.</div>'));
    } else {
      var rows = suggestions.map(function (s) {
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
              '<button class="btn btn--sm th-edit" data-project="' + esc(p.name) + '">Edit</button>' +
              '<button class="btn btn--sm th-reset" data-project="' + esc(p.name) + '" data-key="' + esc(s.key) + '">Reset</button>' +
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
    }
    host.appendChild(el('<div class="thpanel__foot"><button class="btn thbtn" type="button" data-project="' + esc(p.name) + '">\u2699 Edit all thresholds</button></div>'));
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
  function resetThreshold(project, key) {
    if (!APP.serverMode) { copyModal("Reset threshold \u2014 paste into chat", resetThresholdPrompt(project, key)); return; }
    var o = {}; o[key] = null;
    api("/api/thresholds", { project: project, overrides: o })
      .then(function () { rerender(); toast("Reset " + key + " to default"); })
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

    // Onboarding: copy the "run the skill" prompt from the sample-data banner.
    var runBtn = root.querySelector("#runPromptBtn");
    if (runBtn) runBtn.addEventListener("click", function () {
      copyModal("Run the skill \u2014 paste into chat", runPrompt());
    });

    // Deep-page threshold suggestions: Apply / Reset (Edit uses .thbtn below).
    root.querySelectorAll(".th-apply").forEach(function (b) {
      b.addEventListener("click", function () { applySuggestion(b.getAttribute("data-project"), b.getAttribute("data-key"), b.getAttribute("data-val")); });
    });
    root.querySelectorAll(".th-reset").forEach(function (b) {
      b.addEventListener("click", function () { resetThreshold(b.getAttribute("data-project"), b.getAttribute("data-key")); });
    });
    root.querySelectorAll(".th-edit").forEach(function (b) {
      b.addEventListener("click", function () { openThresholds(b.getAttribute("data-project")); });
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
        else onMute(project, key, reason);
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
