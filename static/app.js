/* Logo-derived chart colors (cyan / electric blue / sky) */
const PALETTE = ["#1ed1fa", "#10adf9", "#0f6ed7", "#5fd2f8", "#99bbe5", "#a6dcf7"];

let payload = null;
let chartTurnout = null;
let chartShare = null;
let chartGeo = null;

let tipHoverEl = null;

/** @type {string | null} */
let selectedSampleId = null;

function $(id) {
  return document.getElementById(id);
}

/** Same-origin API URL (works when the app is served from a subpath if we extend base later). */
function apiUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}${p}`;
}

/**
 * Reliable JSON download: fetch + Blob (avoids browsers ignoring <a download> on some responses).
 */
async function downloadElectionJson(url, fallbackFilename) {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        if (j.detail !== undefined) {
          msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        }
      } catch (_) {
        /* use raw text */
      }
      throw new Error(msg || `${res.status} ${res.statusText}`);
    }
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fallbackFilename || "election.json";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  } catch (e) {
    alert(`Download failed: ${e.message || e}`);
  }
}

function setupFloatingTooltips() {
  const tip = $("vl-tooltip");
  if (!tip) return;

  function clamp(pos, size, pad) {
    const maxX = window.innerWidth - size.width - pad;
    const maxY = window.innerHeight - size.height - pad;
    return {
      x: Math.min(Math.max(pad, pos.x), Math.max(pad, maxX)),
      y: Math.min(Math.max(pad, pos.y), Math.max(pad, maxY)),
    };
  }

  function moveTip(clientX, clientY) {
    const pad = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = clientX + 16;
    let y = clientY + 18;
    const pos = clamp({ x, y }, { width: w, height: h }, pad);
    tip.style.left = `${pos.x}px`;
    tip.style.top = `${pos.y}px`;
  }

  function showTip(el, clientX, clientY) {
    const text = el.dataset.tip;
    if (!text) return;
    tipHoverEl = el;
    tip.textContent = text;
    tip.hidden = false;
    requestAnimationFrame(() => moveTip(clientX, clientY));
  }

  function hideTip() {
    tipHoverEl = null;
    tip.hidden = true;
  }

  document.body.addEventListener(
    "pointerover",
    (e) => {
      const el = e.target.closest("[data-tip]");
      if (!el || !el.dataset.tip) return;
      showTip(el, e.clientX, e.clientY);
    },
    true
  );

  document.body.addEventListener(
    "pointermove",
    (e) => {
      if (!tipHoverEl || tip.hidden) return;
      const el = e.target.closest("[data-tip]");
      if (el !== tipHoverEl) return;
      moveTip(e.clientX, e.clientY);
    },
    true
  );

  document.body.addEventListener(
    "pointerout",
    (e) => {
      const from = e.target.closest("[data-tip]");
      const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest("[data-tip]");
      if (from && from === tipHoverEl && from !== to) hideTip();
    },
    true
  );

  document.addEventListener("scroll", hideTip, true);
  window.addEventListener("blur", hideTip);
}

async function fetchSample() {
  const res = await fetch("/api/election/sample");
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function fetchSampleCatalog() {
  const res = await fetch("/api/election/samples");
  if (res.status === 404) {
    console.warn(
      "VoteLens: GET /api/election/samples returned 404 (older server build?). Using GET /api/election/sample only; restart Uvicorn from the latest project code for the sample file grid."
    );
    return { samples: [], default_id: "sample_election", _legacyNoSamplesList: true };
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

async function fetchSampleInsightsById(sampleId) {
  const enc = encodeURIComponent(sampleId);
  const res = await fetch(`/api/election/samples/${enc}/insights`);
  if (res.status === 404) {
    console.warn(
      "VoteLens: per-file insights not available (404). Falling back to GET /api/election/sample. Restart the server from the current VoteLens code to load each JSON file."
    );
    return fetchSample();
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  return res.json();
}

function updateSampleGridSelection() {
  const grid = $("sample-sources-grid");
  if (!grid) return;
  grid.querySelectorAll(".sample-source-card").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.sampleId === selectedSampleId);
  });
}

function renderSampleSourcesGrid(samples, defaultId) {
  const grid = $("sample-sources-grid");
  const section = $("sample-sources-section");
  if (!grid) return;
  grid.innerHTML = "";
  if (!samples.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  samples.forEach((s) => {
    const wrap = document.createElement("div");
    wrap.className = "sample-source-card-wrap";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sample-source-card has-tip";
    btn.dataset.sampleId = s.id;
    if (selectedSampleId === s.id) btn.classList.add("is-selected");
    const dlHref = `/api/election/samples/${encodeURIComponent(s.id)}/download`;
    btn.dataset.tip = [
      `File: ${s.filename}`,
      `Election ID: ${s.election_id}`,
      `Jurisdictions: ${s.jurisdiction_count}`,
      "",
      "Click to load this dataset into the dashboard.",
      `Download: ${dlHref}`,
    ].join("\n");
    btn.innerHTML = `
      <p class="card-file">${escapeHtml(s.filename)}</p>
      <p class="card-title">${escapeHtml(s.title)}</p>
      <p class="card-meta"><code>${escapeHtml(s.election_id)}</code> · ${s.jurisdiction_count} jurisdictions</p>
    `;
    btn.addEventListener("click", () => {
      selectedSampleId = s.id;
      updateSampleGridSelection();
      loadInsightsForSelectedSample().catch((err) => {
        alert(`Load failed: ${err.message || err}`);
      });
    });

    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "sample-download-link";
    dl.textContent = "Download JSON";
    dl.title = `Save ${s.filename} to your computer`;
    dl.addEventListener("click", () => {
      downloadElectionJson(apiUrl(dlHref), s.filename);
    });

    wrap.appendChild(btn);
    wrap.appendChild(dl);
    grid.appendChild(wrap);
  });
  if (selectedSampleId && !samples.some((x) => x.id === selectedSampleId)) {
    selectedSampleId = defaultId && samples.some((x) => x.id === defaultId) ? defaultId : samples[0].id;
  }
  updateSampleGridSelection();
}

function renderMeta(data) {
  const el = $("election-meta");
  const reported = data.reported_at
    ? new Date(data.reported_at).toLocaleString()
    : "Report time not set";
  el.innerHTML = `
    <p class="lead"><strong>${escapeHtml(data.title)}</strong></p>
    <p class="muted">Election ID: <code>${escapeHtml(data.election_id)}</code> · Last reported: ${escapeHtml(
    reported
  )}</p>
  `;
  el.classList.add("has-tip");
  el.dataset.tip = [
    `Election: ${data.title}`,
    `Election ID: ${data.election_id}`,
    data.reported_at ? `Reported (ISO): ${data.reported_at}` : "",
    `Shown in your locale: ${reported}`,
    "",
    "Hover Key numbers, the jurisdiction table, alerts, and story bullets for full figures.",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderKpis(kpis, thresholds) {
  const row = $("kpi-row");
  row.innerHTML = "";
  const th = thresholds || {};
  kpis.forEach((k) => {
    const div = document.createElement("div");
    div.className = "kpi has-tip";
    div.innerHTML = `
      <p class="label">${escapeHtml(k.label)}</p>
      <p class="value">${escapeHtml(k.value)}</p>
      <p class="detail">${escapeHtml(k.detail || "")}</p>
    `;
    const tipLines = [k.label, k.value, ""];
    if (k.detail) tipLines.push(k.detail);
    if (k.id === "turnout" && th.low_turnout_pct != null) {
      tipLines.push("");
      tipLines.push(`Monitoring band: “low” turnout < ${th.low_turnout_pct}%`);
      tipLines.push(`Monitoring band: “high” turnout > ${th.high_turnout_pct}%`);
    }
    if (k.id === "ballots") {
      tipLines.push("");
      tipLines.push("Total ballots summed from each jurisdiction’s ballots_cast field.");
    }
    div.dataset.tip = tipLines.filter(Boolean).join("\n");
    row.appendChild(div);
  });
}

function renderAlerts(alerts) {
  const ul = $("alerts");
  ul.innerHTML = "";
  if (!alerts.length) {
    ul.innerHTML = `<li class="muted">No threshold alerts. Demographics and turnout look steady.</li>`;
    return;
  }
  alerts.forEach((a) => {
    const li = document.createElement("li");
    li.className = `alert has-tip ${a.severity === "warning" ? "warning" : "info"}`;
    li.innerHTML = `<strong>${escapeHtml(a.title)}</strong><span>${escapeHtml(a.message)}</span>`;
    li.dataset.tip = [`Severity: ${a.severity}`, "", a.title, "", a.message].join("\n");
    ul.appendChild(li);
  });
}

function renderNarrative(bullets) {
  const ul = $("narrative");
  ul.innerHTML = "";
  bullets.forEach((b) => {
    const li = document.createElement("li");
    li.className = "has-tip";
    li.textContent = b;
    li.dataset.tip = b;
    ul.appendChild(li);
  });
}

function renderTable(rows) {
  const tbody = document.querySelector("#table-jx tbody");
  tbody.innerHTML = "";
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.className = "has-tip";
    const t = r.turnout_pct != null ? `${r.turnout_pct.toFixed(1)}%` : "—";
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(t)}</td>
      <td>${r.registered != null ? r.registered.toLocaleString() : "—"}</td>
      <td>${r.ballots_cast != null ? r.ballots_cast.toLocaleString() : "—"}</td>
      <td>${r.contest_count}</td>
    `;
    const tip = [
      `Jurisdiction: ${r.name}`,
      r.id ? `ID: ${r.id}` : "",
      "",
      r.turnout_pct != null
        ? `Turnout: ${r.turnout_pct.toFixed(3)}% (ballots cast ÷ registered voters)`
        : "Turnout: not computable (missing registered or ballots)",
      r.registered != null ? `Registered voters: ${r.registered.toLocaleString()}` : "",
      r.ballots_cast != null ? `Ballots cast: ${r.ballots_cast.toLocaleString()}` : "",
      "",
      `Contests in this feed: ${r.contest_count}`,
    ]
      .filter(Boolean)
      .join("\n");
    tr.dataset.tip = tip;
    tbody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildTurnoutChart(jurisdictions) {
  if (typeof Chart === "undefined") return;
  const ctx = $("chart-turnout");
  const labels = jurisdictions.map((j) => j.name);
  const values = jurisdictions.map((j) => (j.turnout_pct != null ? j.turnout_pct : 0));
  if (chartTurnout) chartTurnout.destroy();
  chartTurnout = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Turnout %",
          data: values,
          backgroundColor: "rgba(30, 209, 250, 0.55)",
          borderColor: "rgba(30, 209, 250, 0.95)",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#8ab4d4" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { color: "#8ab4d4", callback: (v) => `${v}%` },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => jurisdictions[items[0].dataIndex].name,
            label: (item) => `Turnout: ${Number(item.raw).toFixed(2)}%`,
            afterBody: (items) => {
              const j = jurisdictions[items[0].dataIndex];
              const lines = [];
              if (j.registered != null) lines.push(`Registered voters: ${j.registered.toLocaleString()}`);
              if (j.ballots_cast != null) lines.push(`Ballots cast: ${j.ballots_cast.toLocaleString()}`);
              lines.push(`Contests in feed: ${j.contest_count}`);
              return lines;
            },
          },
        },
      },
    },
  });
}

function officeData(data, office) {
  const race = data.races.find((r) => r.office === office);
  return race || null;
}

function buildShareChart(race) {
  if (typeof Chart === "undefined") return;
  const ctx = $("chart-share");
  if (!race || !race.candidates.length) {
    if (chartShare) chartShare.destroy();
    return;
  }
  const labels = race.candidates.map((c) => c.name);
  const values = race.candidates.map((c) => c.vote_share_pct);
  const colors = race.candidates.map((_, i) => PALETTE[i % PALETTE.length]);
  if (chartShare) chartShare.destroy();
  chartShare = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors.map((c) => c + "cc"),
          borderColor: "#0a1624",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#d5ecfa" } },
        tooltip: {
          callbacks: {
            title: () => race.office,
            label: (item) => {
              const c = race.candidates[item.dataIndex];
              return `${c.name} (${c.party || "—"}): ${c.vote_share_pct}% — ${c.votes.toLocaleString()} votes`;
            },
            afterBody: () => {
              const lines = [];
              if (race.margin_pct != null) {
                lines.push(`Leader margin vs runner-up: ${race.margin_pct} percentage points`);
              }
              const th = payload && payload.thresholds && payload.thresholds.close_race_margin_pct;
              if (race.is_close_race && th != null) {
                lines.push(`Flagged as close race (margin < ${th} pp)`);
              }
              lines.push(`Total votes (this office, all jurisdictions): ${race.total_votes.toLocaleString()}`);
              return lines;
            },
          },
        },
      },
    },
  });
}

function buildGeoChart(breakdown) {
  if (typeof Chart === "undefined") return;
  const ctx = $("chart-geo");
  if (!breakdown || !breakdown.rows.length) {
    if (chartGeo) chartGeo.destroy();
    return;
  }
  const labels = breakdown.rows.map((r) => r.jurisdiction);
  const keys = breakdown.candidate_keys;
  const datasets = keys.map((key, idx) => ({
    label: breakdown.candidate_labels[idx] || key,
    data: breakdown.rows.map((row) => row[key] || 0),
    backgroundColor: PALETTE[idx % PALETTE.length] + "aa",
    borderRadius: 4,
  }));
  if (chartGeo) chartGeo.destroy();
  chartGeo = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#8ab4d4" },
          grid: { display: false },
        },
        y: {
          stacked: true,
          ticks: { color: "#8ab4d4" },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "bottom", labels: { color: "#d5ecfa", boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title: (items) => breakdown.rows[items[0].dataIndex].jurisdiction,
            label: (ctx) => {
              const row = breakdown.rows[ctx.dataIndex];
              const key = keys[ctx.datasetIndex];
              const votes = row[key] || 0;
              const tot = row.total_votes || 1;
              const pct = ((votes / tot) * 100).toFixed(2);
              return `${ctx.dataset.label}: ${votes.toLocaleString()} votes (${pct}% of this jurisdiction’s votes for ${breakdown.office})`;
            },
            footer: (items) => {
              if (!items.length) return "";
              const row = breakdown.rows[items[0].dataIndex];
              return `Office: ${breakdown.office} · Jurisdiction row total: ${row.total_votes.toLocaleString()} votes`;
            },
          },
        },
      },
    },
  });
}

function fillOfficeSelect(offices, geographic_breakdowns) {
  const sel = $("office-select");
  sel.innerHTML = "";
  offices.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    const office = sel.value;
    const race = officeData(payload, office);
    buildShareChart(race);
    buildGeoChart(geographic_breakdowns[office]);
  };
}

function renderAll(data) {
  try {
    payload = data;
    renderMeta(data);
    renderKpis(data.summary_kpis || [], data.thresholds);
    renderAlerts(data.monitoring_alerts || []);
    renderNarrative(data.narrative_bullets || []);
    renderTable(data.jurisdictions || []);
    buildTurnoutChart(data.jurisdictions || []);
    fillOfficeSelect(data.offices || [], data.geographic_breakdowns || {});
    const firstOffice = data.offices && data.offices[0];
    if (firstOffice) {
      buildShareChart(officeData(data, firstOffice));
      buildGeoChart((data.geographic_breakdowns || {})[firstOffice]);
    }
    if (typeof Chart === "undefined") {
      const meta = $("election-meta");
      if (meta && !meta.querySelector(".vl-chart-warn")) {
        meta.insertAdjacentHTML(
          "beforeend",
          `<p class="vl-error vl-chart-warn">Charts did not load (Chart.js blocked or offline). KPIs, table, and alerts still work. Allow <code>cdn.jsdelivr.net</code> or use the app online.</p>`
        );
      }
    }
  } catch (err) {
    console.error(err);
    const meta = $("election-meta");
    if (meta) {
      meta.innerHTML = `<p class="muted">VoteLens hit an error while rendering.</p><p class="vl-error">${escapeHtml(
        err.message || String(err)
      )}</p>`;
    }
  }
}

async function loadInsightsForSelectedSample() {
  if (!selectedSampleId) {
    const data = await fetchSample();
    renderAll(data);
    return;
  }
  const data = await fetchSampleInsightsById(selectedSampleId);
  renderAll(data);
}

async function bootstrapDashboard() {
  if (window.location.protocol === "file:") {
    const el = $("election-meta");
    if (el) {
      el.innerHTML = `<p class="muted">This page was opened as a file. APIs will not run.</p>
        <p class="vl-error">Start the server from the project folder, then open <code>http://127.0.0.1:8765/</code> (or your port):<br/><code>python -m uvicorn app.main:app --host 127.0.0.1 --port 8765</code></p>`;
    }
    const sec = $("sample-sources-section");
    if (sec) sec.hidden = true;
    return;
  }
  try {
    const catalog = await fetchSampleCatalog();
    const samples = catalog.samples || [];
    const defaultId = catalog.default_id || "sample_election";
    if (!selectedSampleId) {
      selectedSampleId = samples.some((s) => s.id === defaultId) ? defaultId : samples[0]?.id || null;
    }
    renderSampleSourcesGrid(samples, defaultId);
    if (selectedSampleId) {
      await loadInsightsForSelectedSample();
    } else {
      const data = await fetchSample();
      renderAll(data);
    }
    if (catalog._legacyNoSamplesList) {
      const meta = $("election-meta");
      if (meta && !meta.querySelector(".vl-legacy-api-note")) {
        meta.insertAdjacentHTML(
          "beforeend",
          `<p class="vl-legacy-api-note chart-hint" style="margin-top:0.75rem">The sample file grid needs a current server build. Stop Uvicorn, then start again from the project folder so <code>/api/election/samples</code> is registered. You are still viewing data from <code>/api/election/sample</code>.</p>`
        );
      }
    }
  } catch (e) {
    console.error(e);
    const meta = $("election-meta");
    if (meta) {
      meta.innerHTML = `<p class="muted">Could not reach the VoteLens API.</p>
        <p class="vl-error">${escapeHtml(e.message || String(e))}</p>
        <p class="muted" style="margin-top:0.75rem">Is the server running? From the project folder run:<br/><code>python -m uvicorn app.main:app --host 127.0.0.1 --port 8765</code><br/>Then open the same host and port in the browser (not a different port).</p>`;
    }
  }
}

async function reloadCurrentSample() {
  try {
    if (selectedSampleId) {
      const data = await fetchSampleInsightsById(selectedSampleId);
      renderAll(data);
    } else {
      const data = await fetchSample();
      renderAll(data);
    }
  } catch (e) {
    alert(`Reload failed: ${e.message || e}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupFloatingTooltips();
  bootstrapDashboard().catch((e) => {
    console.error(e);
    const meta = $("election-meta");
    if (meta) {
      meta.innerHTML = `<p class="vl-error">${escapeHtml(e.message || String(e))}</p>`;
    }
  });
  $("btn-sample").addEventListener("click", reloadCurrentSample);
  const btnTpl = $("btn-download-template");
  if (btnTpl) {
    btnTpl.addEventListener("click", () => {
      downloadElectionJson(apiUrl("/api/election/template/download"), "vote_lens_template.json");
    });
  }
  $("file-input").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/election/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      selectedSampleId = null;
      updateSampleGridSelection();
      renderAll(data);
    } catch (e) {
      alert(`Upload failed: ${e.message || e}`);
    }
    ev.target.value = "";
  });
});
