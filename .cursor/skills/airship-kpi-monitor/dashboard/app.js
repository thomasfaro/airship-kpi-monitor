/*
 * Airship KPI Monitor — local dashboard renderer.
 * Vanilla JS, no dependencies. Reads window.AIRSHIP_KPI_DATA (set by
 * dashboard-data.js or the committed dashboard-data.sample.js).
 */
(function () {
  "use strict";

  var DEFAULTS = { slackWorkspace: "urbanairship", slackTeamId: "T025Q1VP7" };

  var SEV = {
    danger: { label: "Critical", rank: 0, pill: "pill--danger", row: "row--danger" },
    warning: { label: "Watch", rank: 1, pill: "pill--warning", row: "row--warning" },
    info: { label: "Info", rank: 2, pill: "pill--info", row: "row--info" },
  };

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
    // Need at least 2 runs for a meaningful trend; a single point would render
    // as one full-width block, so skip it until history accumulates.
    if (!values || values.length < 2) return "";
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

  // --- stats -----------------------------------------------------------------
  function computeStats(data) {
    var clients = data.clients || [];
    var projects = 0;
    var inAlert = 0;
    var open = 0;
    clients.forEach(function (c) {
      (c.projects || []).forEach(function (p) {
        projects++;
        var n = (p.alerts && p.alerts.count) || 0;
        open += n;
        if (n > 0) inAlert++;
      });
    });
    var s = data.stats || {};
    return {
      clients: s.clients != null ? s.clients : clients.length,
      projects: s.projects != null ? s.projects : projects,
      projectsInAlert: s.projectsInAlert != null ? s.projectsInAlert : inAlert,
      openAlerts: s.openAlerts != null ? s.openAlerts : open,
      resolutions: s.resolutions != null ? s.resolutions : 0,
    };
  }

  // --- render ----------------------------------------------------------------
  function render(root, data) {
    root.innerHTML = "";

    var headerSpark = "";
    if (data.history && data.history.length > 1) {
      headerSpark =
        '<div class="spark"><span class="spark__label">Open alerts trend</span>' +
        lineSparkline(data.history.map(function (h) { return h.openAlerts || 0; })) +
        "</div>";
    }

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
            '<button class="btn" id="themeBtn" title="Toggle theme">\u25D0 Theme</button>' +
          "</div>" +
        "</div>" +
      "</header>"
    );
    root.appendChild(header);

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

    // toolbar
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

    root.appendChild(setupSection(data));
    root.appendChild(
      el(
        '<footer class="foot">Local snapshot rewritten on each agent run (this page cannot refresh on its own). ' +
          "The live, shareable source is each project\u2019s Slack KPI canvas, linked per project above. " +
          "No secrets are stored in this dashboard.</footer>"
      )
    );

    wireUp(root, data);
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
      return s + ((p.alerts && p.alerts.count) || 0);
    }, 0);
  }

  function clientCard(data, c) {
    var projects = (c.projects || []).slice().sort(function (a, b) {
      return ((b.alerts && b.alerts.count) || 0) - ((a.alerts && a.alerts.count) || 0) ||
        String(a.name).localeCompare(String(b.name));
    });
    var nAlerts = clientAlerts(c);
    var meta = nAlerts > 0
      ? nAlerts + " open alert" + (nAlerts > 1 ? "s" : "") + " \u00B7 " + projects.length + " project" + (projects.length > 1 ? "s" : "")
      : projects.length + " project" + (projects.length > 1 ? "s" : "") + " \u00B7 stable";

    var rows = projects
      .map(function (p) {
        var sev = (p.alerts && p.alerts.worstSeverity) || null;
        var n = (p.alerts && p.alerts.count) || 0;
        var alertCell = n > 0 && sev
          ? '<span class="pill ' + SEV[sev].pill + '">' + n + " " + SEV[sev].label + "</span>"
          : '<span class="pill pill--ok">\u2713 OK</span>';
        var spark = barSparkline(p.alertHistory, sev);
        var hay = (p.name + " " + (c.name || "") + " " + (p.channel || "") + " " + (p.trend || "")).toLowerCase();
        return (
          '<tr class="' + (sev ? SEV[sev].row : "") + '" data-hay="' + esc(hay) + '" data-sev="' + esc(sev || "") + '">' +
            '<td class="cell-project">' + esc(p.name) + "</td>" +
            '<td><a class="chan" href="' + esc(channelLink(data, p.channel)) + '">#' + esc(p.channel) + "</a></td>" +
            '<td class="cell-nowrap">' + esc(p.lastRun || "\u2014") + "</td>" +
            "<td>" + alertCell + "</td>" +
            '<td class="cell-trend">' + trendCell(p.trend) + (spark ? '<div class="trend-spark">' + spark + "</div>" : "") + "</td>" +
            '<td>' + (p.canvasId ? '<a class="linkbtn" href="' + esc(canvasLink(data, p.canvasId)) + '">\uD83D\uDCCA Canvas</a>' : "\u2014") + "</td>" +
          "</tr>"
        );
      })
      .join("");

    return el(
      '<section class="card" data-client="' + esc((c.name || "").toLowerCase()) + '">' +
        '<button class="card__head" type="button">' +
          '<span class="card__caret">\u25BC</span>' +
          '<span class="card__name">' + esc(c.name) + "</span>" +
          '<span class="card__meta">' + esc(meta) + "</span>" +
        "</button>" +
        '<div class="card__body"><table>' +
          "<thead><tr>" +
            "<th>Project</th><th>Channel</th><th>Last run</th><th>Alerts</th><th>Trend (recent runs)</th><th>Link</th>" +
          "</tr></thead>" +
          "<tbody>" + rows + "</tbody>" +
        "</table></div>" +
      "</section>"
    );
  }

  function setupSection(data) {
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
      '<section class="setup collapsed">' +
        '<button class="setup__head" type="button"><span class="card__caret">\u25BC</span>Setup &amp; local configuration</button>' +
        '<div class="setup__grid">' +
          (files ? '<div class="panel"><h3>Local file locations</h3>' + files + "</div>" : "") +
          (todos ? '<div class="panel"><h3>Install checklist</h3><ul class="todo">' + todos + "</ul></div>" : "") +
          (!hasContent ? '<div class="panel"><div class="note">No setup details available.</div></div>' : "") +
        "</div>" +
      "</section>"
    );
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

    // collapse/expand a card
    root.querySelectorAll(".card__head").forEach(function (h) {
      h.addEventListener("click", function () {
        h.parentElement.classList.toggle("collapsed");
      });
    });
    // setup section toggle
    var setupHead = root.querySelector(".setup__head");
    if (setupHead) setupHead.addEventListener("click", function () { setupHead.parentElement.classList.toggle("collapsed"); });

    // collapse/expand all
    var toggleAll = root.querySelector("#toggleAll");
    toggleAll.addEventListener("click", function () {
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
        card.querySelectorAll("tbody tr").forEach(function (tr) {
          var matchTerm = !term || (tr.getAttribute("data-hay") || "").indexOf(term) !== -1;
          var matchSev = !sevs.length || sevs.indexOf(tr.getAttribute("data-sev")) !== -1;
          var show = matchTerm && matchSev;
          tr.style.display = show ? "" : "none";
          if (show) visibleRows++;
        });
        card.style.display = visibleRows ? "" : "none";
        if (visibleRows && (term || sevs.length)) card.classList.remove("collapsed");
      });
    }
    q.addEventListener("input", applyFilter);
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        var s = chip.getAttribute("data-sev");
        activeSev[s] = !activeSev[s];
        chip.setAttribute("aria-pressed", activeSev[s] ? "true" : "false");
        applyFilter();
      });
    });
  }

  // --- boot ------------------------------------------------------------------
  function boot() {
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
    render(root, data);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
