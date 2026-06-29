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

  // Mutable app state shared across renders.
  var APP = { data: null, serverMode: false, state: null, view: "monitor" };

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

    var header = el(
      '<header class="header">' +
        '<div class="header__top">' +
          "<div>" +
            '<h1 class="title"><span class="logo">\uD83D\uDEF0\uFE0F</span>Airship KPI Monitor</h1>' +
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
          '<button class="nav__tab" data-view="monitor" type="button">Monitor</button>' +
          '<button class="nav__tab" data-view="setup" type="button">Setup</button>' +
        "</nav>" +
      "</header>"
    );
    root.appendChild(header);

    var monitor = el('<div id="view-monitor" class="view"></div>');
    var setup = el('<div id="view-setup" class="view"></div>');
    root.appendChild(monitor);
    root.appendChild(setup);

    renderMonitor(monitor, data);
    renderSetup(setup, data);

    root.appendChild(
      el(
        '<footer class="foot">Local snapshot rewritten on each agent run (this page cannot refresh on its own). ' +
          "The live, shareable source is each project\u2019s Slack KPI canvas, linked per project above. " +
          "No secrets are stored in this dashboard.</footer>"
      )
    );

    setActiveView(root, APP.view);
    wireUp(root, data);
  }

  function rerender() { render(document.getElementById("app")); }

  function setActiveView(root, view) {
    APP.view = view;
    root.querySelector("#view-monitor").style.display = view === "monitor" ? "" : "none";
    root.querySelector("#view-setup").style.display = view === "setup" ? "" : "none";
    root.querySelectorAll(".nav__tab").forEach(function (t) {
      t.setAttribute("aria-current", t.getAttribute("data-view") === view ? "true" : "false");
    });
  }

  function renderMonitor(root, data) {
    if (data.isSample || window.__KPI_DATA_FILE_MISSING) {
      root.appendChild(
        el(
          '<div class="banner">\u26A0\uFE0F <span>Showing <strong>sample data</strong>. Run the skill once to generate the local ' +
            "<code>dashboard-data.js</code> with your real projects.</span></div>"
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

    var clients = (data.clients || []).slice().sort(function (a, b) {
      return clientAlerts(b) - clientAlerts(a) || String(a.name).localeCompare(String(b.name));
    });
    clients.forEach(function (c) {
      cardsWrap.appendChild(clientCard(data, c));
    });
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

  // A single project rendered as a self-contained block.
  function projectBlock(data, c, p) {
    var pa = projAlerts(p);
    var sev = pa.worst;

    var badges = "";
    if (pa.count > 0 && sev) {
      badges += '<span class="pill ' + SEV[sev].pill + '">' + pa.count + " " + SEV[sev].label + "</span>";
    } else if (pa.mutedCount === 0) {
      badges += '<span class="pill pill--ok">\u2713 OK</span>';
    }
    if (pa.mutedCount > 0) {
      badges += '<span class="pill pill--muted">\uD83D\uDD15 ' + pa.mutedCount + " muted</span>";
    }

    var alertsHtml = pa.list && pa.list.length
      ? alertsDetail(p.name, pa.list, data.generatedAt)
      : '<div class="proj__empty">\u2713 No open alerts</div>';
    var spark = barSparkline(p.alertHistory, sev);
    var canvas = p.canvasId
      ? '<a class="linkbtn" href="' + esc(canvasLink(data, p.canvasId)) + '">\uD83D\uDCCA Canvas</a>'
      : "";
    var thr = '<button class="linkbtn thbtn" type="button" data-project="' + esc(p.name) + '">\u2699 Thresholds</button>';

    var mutedKeys = (pa.list || []).filter(function (a) { return a.muted; }).map(function (a) { return a.key; }).join(" ");
    var hay = (p.name + " " + (c.name || "") + " " + (p.channel || "") + " " +
      (Array.isArray(p.trend) ? p.trend.join(" ") : p.trend || "") + " " + mutedKeys).toLowerCase();

    return (
      '<article class="proj' + (sev ? " proj--" + sev : "") + '" data-hay="' + esc(hay) + '" data-sev="' + esc(sev || "") + '">' +
        '<div class="proj__head">' +
          '<div class="proj__id">' +
            '<span class="proj__name">' + esc(p.name) + "</span>" +
            '<a class="chan" href="' + esc(channelLink(data, p.channel)) + '">#' + esc(p.channel) + "</a>" +
          "</div>" +
          '<div class="proj__head-right">' +
            '<span class="proj__badges">' + badges + "</span>" +
            '<span class="proj__when">\uD83D\uDD52 ' + esc(p.lastRun || "\u2014") + "</span>" +
            thr +
            canvas +
          "</div>" +
        "</div>" +
        '<div class="proj__body">' +
          '<div class="proj__col proj__col--alerts">' +
            '<div class="proj__label">Open alerts</div>' +
            alertsHtml +
          "</div>" +
          '<div class="proj__col proj__col--trend">' +
            '<div class="proj__label">Trend \u00B7 recent runs</div>' +
            '<div class="proj__trend">' + trendCell(p.trend) +
              (spark ? '<div class="trend-spark">' + spark + "</div>" : "") +
            "</div>" +
          "</div>" +
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
      '<div class="cfrm__grid">' + fields + regionSel + enabledChk + "</div>" +
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

  function setupReadOnly(data) {
    var setup = data.setup || {};
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
    var hasContent = files || todos;
    return el(
      '<div class="setup__grid">' +
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

    // view tabs
    root.querySelectorAll(".nav__tab").forEach(function (t) {
      t.addEventListener("click", function () { setActiveView(root, t.getAttribute("data-view")); });
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
