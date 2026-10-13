// Marketing dashboard UI. Data comes from Code.gs via google.script.run when hosted on Apps
// Script, or from window.SAMPLE_DATA when the page is opened locally for a preview.
(function () {
  const M = window.Metrics;
  const F = window.Flags;
  const C = window.Charts;
  const $ = (s) => document.querySelector(s);
  const app = $('#app');

  const state = {
    data: null,
    spendByMonth: null,
    channels: null,
    period: 'ytd_complete',
    from: null,
    to: null,
    pipeline: 'all',
    serviceLine: 'all',
    serviceLines: null,
    basis: 'cohort',
    includeUnknown: false,
    sort: { key: 'revenue', dir: -1 },
    workbook: null,
    flags: [],
    reviews: {},
    showReviewed: false,
    editing: null, // flag id whose review note is open
  };

  // ---- formatting ----
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => (v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
  const money2 = (v) => (v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  function moneyShort(v) {
    if (v == null) return '—';
    const a = Math.abs(v);
    if (a >= 1e6) return `${v < 0 ? '-' : ''}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e4) return `${v < 0 ? '-' : ''}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
    return money(v);
  }
  const axisMoney = (v) => (v >= 1e6 ? `$${v / 1e6}M` : v >= 1e3 ? `$${v / 1e3}K` : `$${v}`);
  const int = (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
  const pct = (v, d) => (v == null ? '—' : `${(v * 100).toFixed(d == null ? 0 : d)}%`);
  const roas = (v) => (v == null ? '—' : `${v.toFixed(1)}×`);
  // Return on spend pill, coloured by the standards: under 3.0× trips CS-1, over 8.0× is CS-3 territory.
  function retPill(v, maturing) {
    if (v == null) return '<span class="pill flat">—</span>';
    const r = (state.data.config && state.data.config.flagRules) || {};
    const lo = r.cs1MinReturn || 3;
    const hi = r.cs3MinReturn || 8;
    const cls = v < lo ? 'bad' : v > hi ? 'good' : 'flat';
    return `<span class="pill ${cls}" title="${maturing ? 'Includes lead months under 90 days old: still maturing' : ''}">${roas(v)}${maturing ? '*' : ''}</span>`;
  }

  // ---- data loading ----
  function load(force) {
    const btn = $('#refreshBtn');
    btn.disabled = true;
    btn.textContent = force ? 'Refreshing…' : 'Loading…';
    const done = (json) => {
      btn.disabled = false;
      btn.textContent = 'Refresh data';
      try {
        prepare(typeof json === 'string' ? JSON.parse(json) : json);
        render();
        loadReviews();
      } catch (e) {
        showError(e);
      }
    };
    if (window.google && google.script && google.script.run) {
      google.script.run.withSuccessHandler(done).withFailureHandler((e) => { btn.disabled = false; btn.textContent = 'Refresh data'; showError(e); }).getDashboardData(!!force);
    } else if (window.SAMPLE_DATA) {
      setTimeout(() => done(window.SAMPLE_DATA), 50);
    } else {
      showError(new Error('No data source. Open this page from the Apps Script web app.'));
    }
  }

  function showError(e) {
    app.innerHTML = `<div class="notice"><span class="icon">!</span><div><strong>Couldn’t load the dashboard.</strong><br>${esc(e && e.message ? e.message : e)}</div></div>`;
  }

  // ---- review flags: shared via Apps Script, or this browser only in the preview ----
  const REVIEW_KEY = 'pmd-flag-reviews';
  const hasServer = () => window.google && google.script && google.script.run;

  function localReviews() {
    try { return JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}'); } catch (e) { return {}; }
  }

  function loadReviews() {
    if (hasServer()) {
      google.script.run.withSuccessHandler((json) => { state.reviews = JSON.parse(json || '{}'); renderFlags(); }).getReviews();
    } else {
      state.reviews = localReviews();
      renderFlags();
    }
  }

  // decision: 'accepted' | 'overridden' (needs a reason) | 'open' (reopen; history is kept)
  function decide(id, decision, note, title) {
    if (decision === 'overridden' && !String(note || '').trim()) {
      alertFlags('An override needs a reason: it goes in the decision log.');
      return;
    }
    if (hasServer()) {
      google.script.run
        .withSuccessHandler((json) => { state.reviews = JSON.parse(json || '{}'); state.editing = null; renderFlags(); })
        .withFailureHandler((e) => alertFlags(`Couldn’t save the decision: ${e && e.message ? e.message : e}`))
        .saveReview(id, decision, note || '', title || '');
      return;
    }
    const all = localReviews();
    const rec = all[id] || {};
    const entry = { decision, note: note || '', by: 'you (this browser)', at: new Date().toISOString() };
    rec.title = title || rec.title || '';
    rec.history = (rec.history || []).concat([entry]).slice(-20);
    rec.decision = decision === 'open' ? null : decision;
    rec.note = decision === 'open' ? '' : entry.note;
    rec.by = entry.by;
    rec.at = entry.at;
    all[id] = rec;
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(all)); } catch (e) { /* storage blocked: keep in memory */ }
    state.reviews = all;
    state.editing = null;
    renderFlags();
  }

  function alertFlags(msg) {
    const box = $('#flagsMsg');
    if (box) { box.textContent = msg; box.hidden = false; }
  }

  function prepare(data) {
    state.data = data;
    state.channels = (data.config && data.config.channels) || M.DEFAULT_CHANNELS;
    state.serviceLines = (data.config && data.config.serviceLines) || M.DEFAULT_SERVICE_LINES;
    const workbook = data.workbook || M.parseSpendWorkbook(data.spendTabs || [], { year: data.year, budgetTab: data.budgetTab });
    state.workbook = workbook;
    const baseSpend = data.spendByMonth || M.buildSpend(workbook, { channels: state.channels, windsor: data.windsor });
    const ev = M.applyEventCosts(baseSpend, data.deals, data.config && data.config.eventCosts, state.channels);
    state.spendByMonth = ev.spendByMonth;
    state.events = ev.events;
    state.ledgerMonth = Object.values(baseSpend).filter((r) => r.basis === 'actual' && /QuickBooks/.test(r.source || '')).map((r) => r.month).sort().pop() || null;
    if (!workbook.budget.length && !Object.keys(workbook.transactions).length && !data.spendByMonth) {
      (data.warnings = data.warnings || []).push('No spend found on the advertising sheet: check the sheet ID and tab names in Code.gs.');
    }
    setupFilters();
    const when = new Date(data.generatedAt);
    $('#updated').textContent = `Updated ${when.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
  }

  // ---- filters ----
  function availableMonths() {
    const d = state.data;
    const first = M.addMonths(`${d.year || d.currentMonth.slice(0, 4)}-01`, -12);
    return M.monthRange(first, d.currentMonth);
  }

  let filtersReady = false;
  function setupFilters() {
    const d = state.data;
    const presets = M.presets(d.currentMonth);
    $('#period').innerHTML = presets.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('') + '<option value="custom">Custom range…</option>';
    const months = availableMonths();
    const opts = months.map((m) => `<option value="${m}">${M.monthLabel(m, true)}</option>`).reverse().join('');
    $('#fromMonth').innerHTML = opts;
    $('#toMonth').innerHTML = opts;
    const pipes = [...new Set((d.pipelines && d.pipelines.length ? d.pipelines : d.deals.map((x) => x.pipeline)).filter(Boolean))];
    $('#pipeline').innerHTML = '<option value="all">All pipelines</option>' + pipes.map((p) => `<option>${esc(p)}</option>`).join('');
    $('#pipeline').closest('.field').hidden = pipes.length < 2;
    $('#serviceLine').innerHTML = '<option value="all">All service lines</option>' + state.serviceLines.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
    applyPeriod(state.period);
    syncControls();
    if (filtersReady) return;
    filtersReady = true;

    $('#period').addEventListener('change', (e) => { applyPeriod(e.target.value); syncControls(); render(); });
    $('#fromMonth').addEventListener('change', (e) => { state.from = e.target.value; if (state.to < state.from) state.to = state.from; syncControls(); render(); });
    $('#toMonth').addEventListener('change', (e) => { state.to = e.target.value; if (state.from > state.to) state.from = state.to; syncControls(); render(); });
    $('#pipeline').addEventListener('change', (e) => { state.pipeline = e.target.value; render(); });
    $('#serviceLine').addEventListener('change', (e) => { state.serviceLine = e.target.value; render(); });
    $('#includeUnknown').addEventListener('change', (e) => { state.includeUnknown = e.target.checked; render(); });
    document.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => {
      state.basis = b.dataset.basis; syncControls(); render();
    }));
    $('#refreshBtn').addEventListener('click', () => load(true));
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => state.data && renderCharts(lastSummary), 150); });
  }

  function applyPeriod(id) {
    state.period = id;
    if (id === 'custom') return;
    const p = M.presets(state.data.currentMonth).find((x) => x.id === id) || M.presets(state.data.currentMonth)[0];
    state.from = p.from;
    state.to = p.to;
  }

  function syncControls() {
    $('#period').value = state.period;
    document.querySelectorAll('.custom-range').forEach((n) => { n.hidden = state.period !== 'custom'; });
    $('#fromMonth').value = state.from;
    $('#toMonth').value = state.to;
    $('#pipeline').value = state.pipeline;
    $('#serviceLine').value = state.serviceLine;
    $('#includeUnknown').checked = state.includeUnknown;
    document.querySelectorAll('.segmented button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.basis === state.basis)));
  }

  // ---- render ----
  let lastSummary = null;

  const summaryData = () => ({ deals: state.data.deals, spendByMonth: state.spendByMonth, config: { channels: state.channels, serviceLines: state.serviceLines } });
  const summaryOpts = (from, to) => ({
    from, to, asOf: state.data.generatedAt, pipeline: state.pipeline, serviceLine: state.serviceLine, basis: state.basis,
    includeUnknown: state.includeUnknown, channels: state.channels, serviceLines: state.serviceLines,
  });

  function summarize(from, to) {
    return M.summarize(summaryData(), summaryOpts(from, to));
  }

  function periodName(from, to) {
    return from === to ? M.monthLabel(from, true) : `${M.monthLabel(from)} ${from.slice(0, 4) !== to.slice(0, 4) ? from.slice(0, 4) + ' ' : ''}– ${M.monthLabel(to, true)}`;
  }

  function render() {
    if (!state.data) return;
    const s = summarize(state.from, state.to);
    const prevRange = M.previousPeriod(state.from, state.to);
    const prev = summarize(prevRange.from, prevRange.to);
    // Only compare against a prior period that has both spend and leads recorded.
    const hasPrev = prev.total.leads > 0 && prev.total.spend > 0;
    lastSummary = s;
    const lines = M.summarizeServiceLines(summaryData(), Object.assign(summaryOpts(state.from, state.to), { serviceLine: 'all' }));
    // Standards triggers run on all deals as of today (they define their own windows);
    // the dashboard checks follow the selected period.
    const ev = F.evaluate({
      deals: state.data.deals,
      spendByMonth: state.spendByMonth,
      channels: state.channels,
      events: state.events,
      asOf: state.data.generatedAt,
      currentMonth: state.data.currentMonth,
      ledgerMonth: state.ledgerMonth,
      rules: state.data.config && state.data.config.flagRules,
      summary: s,
      lines,
      budget: M.budgetVsActual(state.workbook, state.spendByMonth, s.months, state.channels),
      unmatched: M.unmatchedSpend(state.spendByMonth, s.months),
    });
    state.flags = ev.flags;
    state.register = ev.register;

    app.innerHTML = `
      ${noticesHtml(s)}
      <section class="kpis-hero" aria-label="Headline numbers">${heroKpis(s, hasPrev ? prev : null)}</section>
      <section class="kpis-small" aria-label="More numbers">${smallKpis(s, hasPrev ? prev : null)}</section>
      <section class="card flags" id="flags" aria-labelledby="flagsTitle">
        <div class="card-head">
          <div><h2 id="flagsTitle">Standards &amp; review flags</h2><div class="sub">Triggers from the Marketing Standards &amp; Trigger System, checked as of ${esc(new Date(state.data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))}. Each tripped trigger needs a decision: accept the recommendation, or override it with a reason.</div></div>
          <div id="flagsCounts" class="flag-counts"></div>
        </div>
        <p id="flagsMsg" class="notice" hidden></p>
        <div id="flagsBody"></div>
      </section>
      <section class="grid-2">
        <div class="card">
          <div class="card-head">
            <div><h2>Spend vs. job revenue</h2><div class="sub">${esc(periodName(state.from, state.to))} · by ${state.basis === 'closed' ? 'close' : 'lead'} month</div></div>
            <div class="legend"><span class="spend"><i></i>Working media spend</span><span class="revenue"><i></i>Job revenue</span>${state.basis !== 'closed' ? '<span class="revenue maturing"><i></i>Still maturing (&lt;90 days)</span>' : ''}</div>
          </div>
          <div class="chart" id="chartSpendRev"></div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><div><h2>Cost per lead</h2><div class="sub">Spend ÷ leads each month</div></div></div>
            <div class="chart" id="chartCpl"></div>
          </div>
          <div class="card">
            <div class="card-head"><div><h2>Leads per month</h2><div class="sub">New HubSpot deals</div></div></div>
            <div class="chart" id="chartLeads"></div>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <div><h2>Channels</h2><div class="sub">Spend from the advertising sheet · leads and jobs from HubSpot “Known lead source”. Click a column to sort.</div></div>
        </div>
        <div class="table-wrap">${channelTable(s)}</div>
      </section>
      <section class="card">
        <div class="card-head">
          <div><h2>Service lines</h2><div class="sub">From HubSpot “Type of Job”. Spend isn't tagged by service line, so it's split by each channel's share of leads (estimate). Click a row to filter the dashboard.</div></div>
        </div>
        <div class="table-wrap">${serviceLineTable(lines)}</div>
      </section>
      <section class="grid-3">
        <div class="card">
          <div class="card-head"><div><h2>Website traffic</h2><div class="sub">HubSpot tracking, by traffic source</div></div></div>
          <div id="webBars"></div>
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Funnel</h2><div class="sub">${esc(periodName(state.from, state.to))}</div></div></div>
          ${funnelHtml(s)}
        </div>
        <div class="card">
          <div class="card-head"><div><h2>Needs attention</h2><div class="sub">Closed Won deals with no Aspire Opportunity #</div></div></div>
          ${attentionHtml(s)}
        </div>
      </section>
      <section class="card">${spendDetailHtml(s)}</section>
    `;

    app.querySelectorAll('tr[data-line]').forEach((tr) => {
      const pick = () => { state.serviceLine = state.serviceLine === tr.dataset.line ? 'all' : tr.dataset.line; syncControls(); render(); };
      tr.addEventListener('click', pick);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    });
    app.querySelectorAll('table.channels:not(.lines) thead th[data-key]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.key;
      state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'name' || k === 'cpl' || k === 'costPerJob' ? 1 : -1) };
      render();
    }));
    renderCharts(s);
    renderWeb();
    renderFlags();
  }

  // ---- flags panel ----
  const SEV = {
    breach: { label: 'Breaching', icon: '!!' },
    watch: { label: 'Watch', icon: '!' },
    opportunity: { label: 'Opportunity', icon: '↑' },
    info: { label: 'FYI', icon: 'i' },
  };
  const STATUS = {
    breach: ['breach', 'Breaching'], watch: ['watch', 'Watch'], gap: ['info', 'Known gap'], opportunity: ['opportunity', 'Scale-up'],
    insufficient: ['neutral', 'Insufficient data'], green: ['ok', 'Green'], manual: ['neutral', 'Manual check'], 'not-measured': ['neutral', 'Needs Aspire'],
  };
  const flagDom = (id) => `flag-${id.replace(/[^\w-]/g, '-')}`;
  const decisionOf = (f) => state.reviews[f.id] && state.reviews[f.id].decision;
  const isOpen = (f) => !decisionOf(f);
  // Overrides per rule across all decisions; three means the threshold is wrong (standards).
  function overrideCounts() {
    const out = {};
    Object.entries(state.reviews).forEach(([id, rec]) => {
      const rule = id.split(':')[0];
      (rec.history || []).forEach((h) => { if (h.decision === 'overridden') out[rule] = (out[rule] || 0) + 1; });
    });
    return out;
  }

  // Small marker for a table row that has open flags.
  function rowFlag(type, id) {
    const open = state.flags.filter((f) => f.target && f.target.type === type && f.target.id === id && isOpen(f));
    if (!open.length) return '';
    return ` <a class="row-flag sev-${open[0].severity}" href="#${flagDom(open[0].id)}" title="${esc(open.map((f) => `${f.rule}: ${f.title}`).join('\n'))}" onclick="event.stopPropagation()">⚑ ${open.length}</a>`;
  }

  function renderFlags() {
    const body = $('#flagsBody');
    if (!body) return;
    const open = state.flags.filter(isOpen);
    const decided = state.flags.filter((f) => !isOpen(f));
    const counts = {};
    open.forEach((f) => { counts[f.severity] = (counts[f.severity] || 0) + 1; });
    $('#flagsCounts').innerHTML = Object.keys(SEV).filter((k) => counts[k])
      .map((k) => `<span class="sev-chip sev-${k}"><b aria-hidden="true">${SEV[k].icon}</b>${counts[k]} ${SEV[k].label.toLowerCase()}</span>`).join('')
      || '<span class="sev-chip sev-ok"><b aria-hidden="true">✓</b>Nothing waiting on a decision</span>';
    const badge = $('#flagBadge');
    if (badge) {
      badge.hidden = !open.length;
      badge.textContent = `⚑ ${open.length} to decide`;
    }
    const list = state.showReviewed ? open.concat(decided) : open;
    let html = list.length ? `<ul class="flag-list">${list.map(flagItem).join('')}</ul>`
      : '<p class="muted">No tripped triggers are waiting on a decision.</p>';
    if (decided.length) {
      html += `<button type="button" class="link-btn" id="toggleReviewed">${state.showReviewed ? 'Hide' : 'Show'} ${decided.length} decided</button>`;
    }
    html += registerHtml() + decisionLogHtml();
    if (!hasServer()) html += '<p class="muted small">In this preview, decisions are saved in your browser only. On the live dashboard they are shared with everyone.</p>';
    body.innerHTML = html;

    body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const li = b.closest('[data-flag]');
      const id = li.dataset.flag;
      const f = state.flags.find((x) => x.id === id) || {};
      const act = b.dataset.act;
      const note = () => { const n = $(`#note-${flagDom(id)}`); return n ? n.value.trim() : ''; };
      if (act === 'accept' || act === 'override') { state.editing = { id, mode: act }; renderFlags(); const n = $(`#note-${flagDom(id)}`); if (n) n.focus(); }
      if (act === 'cancel') { state.editing = null; renderFlags(); }
      if (act === 'save-accept') decide(id, 'accepted', note(), `${f.rule}: ${f.title}`);
      if (act === 'save-override') decide(id, 'overridden', note(), `${f.rule}: ${f.title}`);
      if (act === 'reopen') decide(id, 'open', '', `${f.rule}: ${f.title}`);
    }));
    const t = $('#toggleReviewed');
    if (t) t.addEventListener('click', () => { state.showReviewed = !state.showReviewed; renderFlags(); });
    // Refresh row markers in the tables without a full re-render.
    app.querySelectorAll('[data-rowflag]').forEach((n) => { const [type, id] = n.dataset.rowflag.split('|'); n.innerHTML = rowFlag(type, id); });
  }

  function dealList(ids) {
    const byId = new Map(state.data.deals.map((d) => [String(d.id), d]));
    const portal = state.data.portalId;
    const items = ids.slice(0, 25).map((id) => byId.get(String(id))).filter(Boolean).map((d) => {
      const nm = esc(d.name || `Deal ${d.id}`);
      const link = portal && !/^(p|sample)/.test(String(d.id)) ? `<a href="https://app.hubspot.com/contacts/${portal}/record/0-3/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${nm}</a>` : nm;
      const days = d.stageDays != null ? (d.stageDays < 1 ? `${Math.round(d.stageDays * 24)} h` : `${Math.round(d.stageDays)} days`) : '';
      return `<li>${link} <span class="muted">· ${esc(d.stage)}${days ? ` · ${days}` : ''}${d.owner ? ` · ${esc(d.owner)}` : ''}</span></li>`;
    }).join('');
    return `<details class="flag-deals"><summary>Show ${ids.length} deal${ids.length === 1 ? '' : 's'}</summary><ul>${items}</ul>${ids.length > 25 ? `<p class="muted small">+ ${ids.length - 25} more</p>` : ''}</details>`;
  }

  function flagItem(f) {
    const r = state.reviews[f.id];
    const sev = SEV[f.severity];
    const ed = state.editing && state.editing.id === f.id ? state.editing.mode : null;
    const when = r && r.at ? new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    let foot;
    if (r && r.decision) {
      foot = `<div class="flag-review ${r.decision}"><span>${r.decision === 'accepted' ? '✓ Accepted' : '↷ Overridden'} by ${esc(r.by)}${when ? ` on ${when}` : ''}${r.note ? `: “${esc(r.note)}”` : ''}</span>
        <button type="button" class="btn small" data-act="reopen">Reopen</button></div>`;
    } else if (ed) {
      const ov = ed === 'override';
      foot = `<div class="flag-edit">
        <label for="note-${flagDom(f.id)}" class="small muted">${ov ? 'Reason for overriding (required, goes in the decision log)' : 'Note (optional): what will be done, by whom'}</label>
        <textarea id="note-${flagDom(f.id)}" rows="2" maxlength="500" placeholder="${ov ? 'e.g. Spring cohort still closing; revisit in December' : 'e.g. Cut Google budget 25% from Nov 1'}"></textarea>
        <div class="flag-buttons"><button type="button" class="btn small primary" data-act="save-${ed}">${ov ? 'Save override' : 'Accept recommendation'}</button><button type="button" class="btn small" data-act="cancel">Cancel</button></div>
      </div>`;
    } else {
      foot = '<div class="flag-buttons"><button type="button" class="btn small primary" data-act="accept">Accept…</button><button type="button" class="btn small" data-act="override">Override…</button></div>';
    }
    return `<li class="flag sev-${f.severity}${r && r.decision ? ' is-reviewed' : ''}" id="${flagDom(f.id)}" data-flag="${esc(f.id)}">
      <div class="flag-main">
        <div class="flag-top"><span class="sev-chip sev-${f.severity}"><b aria-hidden="true">${sev.icon}</b>${sev.label}</span><span class="flag-rule">${esc(f.rule)}</span><span class="flag-area">${esc(f.area)}${f.owner ? ` · ${esc(f.owner)}` : ''}</span></div>
        <h3>${esc(f.title)}</h3>
        <p>${esc(f.detail)}</p>
        <p class="flag-action"><strong>Recommended:</strong> ${esc(f.action)}</p>
        ${f.deals && f.deals.length ? dealList(f.deals) : ''}
      </div>
      ${foot}
    </li>`;
  }

  function registerHtml() {
    const ov = overrideCounts();
    const limit = (state.data.config && state.data.config.flagRules && state.data.config.flagRules.overrideLimit) || 3;
    const rows = (state.register || []).map((r) => {
      const [cls, label] = STATUS[r.status] || ['neutral', r.status];
      const over = ov[r.id] || 0;
      return `<tr>
        <td class="nowrap"><b>${esc(r.id)}</b></td>
        <td>${esc(r.name)}<span class="ch-note">${esc(r.trigger)}</span></td>
        <td>${esc(r.cadence)}</td>
        <td>${esc(r.owner)}</td>
        <td><span class="sev-chip sev-${cls}">${label}</span>${over >= limit ? `<span class="ch-note warn-text">Overridden ${over}× — revisit the threshold now</span>` : over ? `<span class="ch-note">Overridden ${over}×</span>` : ''}</td>
        <td class="muted small">${esc(r.detail)}</td>
      </tr>`;
    }).join('');
    const breaching = (state.register || []).filter((r) => r.status === 'breach').length;
    return `<details class="register"${breaching ? '' : ' open'}>
      <summary>Trigger register: ${breaching} of ${(state.register || []).length} rules breaching</summary>
      <div class="table-wrap"><table class="channels lines register-table">
        <thead><tr><th>ID</th><th>Rule</th><th>Check</th><th>Owner</th><th>Status today</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="muted small">“Needs Aspire” rules (cold quotes, quote-to-close, HubSpot record before Aspire job, lost dispositions, revenue waterfall) can’t be checked until Aspire data reaches the dashboard.</p>
    </details>`;
  }

  function decisionLogHtml() {
    const entries = [];
    Object.entries(state.reviews).forEach(([id, rec]) => (rec.history || []).forEach((h) => entries.push(Object.assign({ id, title: rec.title }, h))));
    if (!entries.length) return '';
    entries.sort((a, b) => (a.at < b.at ? 1 : -1));
    const label = { accepted: 'Accepted', overridden: 'Overridden', open: 'Reopened' };
    return `<details class="register">
      <summary>Decision log (${entries.length})</summary>
      <div class="table-wrap"><table class="channels lines register-table">
        <thead><tr><th>Date</th><th>Rule / flag</th><th>Decision</th><th>By</th><th>Reason / note</th></tr></thead>
        <tbody>${entries.slice(0, 100).map((e) => `<tr>
          <td class="nowrap">${new Date(e.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td>${esc(e.title || e.id)}</td><td>${label[e.decision] || e.decision}</td><td>${esc(e.by)}</td><td>${esc(e.note)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="muted small">Overrides and threshold changes also belong in the standards doc’s change log.</p>
    </details>`;
  }


  function noticesHtml(s) {
    const items = (state.data.warnings || []).slice();
    if (s.estimatedMonths.length) {
      const names = s.estimatedMonths.map((m) => M.monthLabel(m)).join(', ');
      items.push(`No actual spend recorded yet for ${names}: those months use the budget column, so CPL and ROI there are estimates.`);
    }
    if (s.allocated) {
      const what = [state.serviceLine !== 'all' && (state.serviceLines.find((l) => l.id === state.serviceLine) || {}).name, state.pipeline !== 'all' && state.pipeline].filter(Boolean).join(' · ');
      items.push(`Filtered to ${what}. Spend isn't tagged by service line or pipeline, so it's estimated by splitting each channel's spend by its share of leads.`);
    }
    if (!items.length) return '';
    return `<div class="notice-list">${items.map((t) => `<div class="notice"><span class="icon">!</span><div>${esc(t)}</div></div>`).join('')}</div>`;
  }

  // Delta vs previous period; lowerIsBetter flips the color.
  function delta(cur, prev, lowerIsBetter, kind) {
    if (cur == null || prev == null || !isFinite(prev) || prev === 0) return '<span class="delta flat">No prior period</span>';
    const diff = kind === 'pts' ? cur - prev : (cur - prev) / Math.abs(prev);
    if (Math.abs(diff) < 0.005) return '<span class="delta flat">→ Same as prior period</span>';
    const up = diff > 0;
    const good = lowerIsBetter ? !up : up;
    const amount = kind === 'pts' ? `${Math.abs(Math.round(diff * 100))} pts` : pct(Math.abs(diff));
    return `<span class="delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${amount} vs prior period</span>`;
  }

  function heroKpis(s, p) {
    const t = s.total;
    const est = s.estimatedMonths.length || s.allocated ? '<span class="est">est.</span>' : '';
    const mat = s.matured;
    const maturing = s.months.length - mat.months.length;
    return [
      { label: 'Cost per lead', value: money(t.cpl), est, d: delta(t.cpl, p && p.total.cpl, true), note: `${int(t.leads)} marketing leads · working media only` },
      { label: 'Qualified cost per lead', value: money(t.qcpl), est, d: delta(t.qcpl, p && p.total.qcpl, true), note: `Leads minus ${int(t.killed)} killed at phone` },
      {
        label: 'Return on spend', value: mat.ret == null ? '—' : roas(mat.ret), est,
        d: mat.ret == null ? `<span class="delta flat">${state.basis === 'closed' ? 'Switch to Lead month: return is credited to the lead month' : 'No lead month is 90 days old yet'}</span>`
          : `<span class="delta flat">${mat.months.length} matured month${mat.months.length === 1 ? '' : 's'}${maturing ? `; ${maturing} still maturing, left out` : ''}</span>`,
        note: mat.ret == null ? '' : `${moneyShort(mat.revenue)} job revenue on ${moneyShort(mat.spend)} · HubSpot amounts, not Aspire won $`,
      },
      { label: 'Working media spend', value: moneyShort(t.spend), est, d: delta(t.spend, p && p.total.spend, true), note: `Excludes ${money(s.excludedSpend)} software & HBA amortisation` },
    ].map((k) => `
      <div class="card kpi accent">
        <div class="label">${k.label}${k.est || ''}</div>
        <div class="value num">${k.value}</div>
        <div>${k.d}</div>
        <div class="foot-note">${k.note}</div>
      </div>`).join('');
  }

  function smallKpis(s, p) {
    const t = s.total;
    return [
      { label: 'Marketing leads', value: int(t.leads), d: delta(t.leads, p && p.total.leads) },
      { label: 'Killed at phone', value: pct(t.killedRate), d: delta(t.killedRate, p && p.total.killedRate, true, 'pts') },
      { label: 'Jobs closed', value: int(t.jobs), d: delta(t.jobs, p && p.total.jobs) },
      { label: 'Lead → job rate', value: pct(t.closeRate, 1), d: delta(t.closeRate, p && p.total.closeRate, false, 'pts') },
      { label: 'Job revenue', value: moneyShort(t.revenue), d: delta(t.revenue, p && p.total.revenue) },
      { label: 'Avg job value', value: money(t.avgJob), d: delta(t.avgJob, p && p.total.avgJob) },
      {
        label: 'Self-sourced revenue', cls: 'gap', value: moneyShort(s.unattributed.revenue),
        d: `<span class="delta flat">${pct(s.unattributed.share)} of all job revenue · ${int(s.unattributed.jobs)} jobs · no budget line</span>`,
      },
    ].map((k) => `
      <div class="card kpi ${k.cls || ''}">
        <div class="label">${k.label}</div>
        <div class="value num">${k.value}</div>
        <div>${k.d}</div>
      </div>`).join('');
  }

  function renderCharts(s) {
    if (!s) return;
    const labels = s.months.map((m) => M.monthLabel(m));
    const rows = s.months.map((m) => s.byMonth[m]);
    const basisOf = (m) => (state.spendByMonth[m] ? state.spendByMonth[m].basis : 'none');
    const tip = (i) => {
      const r = rows[i];
      const m = s.months[i];
      const b = basisOf(m);
      const young = !M.isMatured(m, state.data.generatedAt);
      return `<h4>${M.monthLabel(m, true)}${b !== 'actual' ? ' <span class="est">est.</span>' : ''}</h4>
        ${young && state.basis !== 'closed' ? '<div class="small muted">Under 90 days old: revenue still maturing</div>' : ''}
        <div class="row"><span><i style="background:var(--series-spend)"></i>Spend</span><span>${money(r.spend)}</span></div>
        <div class="row"><span><i style="background:var(--series-revenue)"></i>Job revenue</span><span>${money(r.revenue)}</span></div>
        <div class="row"><span>Leads</span><span>${int(r.leads)}</span></div>
        <div class="row"><span>Jobs</span><span>${int(r.jobs)}</span></div>
        <div class="row"><span>Cost per lead</span><span>${money2(r.cpl)}</span></div>
        <div class="row"><span>Qualified CPL</span><span>${money2(r.qcpl)}</span></div>
        <div class="row"><span>Return on spend</span><span>${roas(r.roas)}</span></div>`;
    };
    C.columns($('#chartSpendRev'), {
      labels, fmt: axisMoney, tip, height: 400,
      barClass: (i, ser) => (ser.cls === 'revenue' && state.basis !== 'closed' && !M.isMatured(s.months[i], state.data.generatedAt) ? 'maturing' : ''),
      ariaLabel: 'Monthly marketing spend and job revenue',
      series: [
        { name: 'Spend', cls: 'spend', values: rows.map((r) => r.spend) },
        { name: 'Revenue', cls: 'revenue', values: rows.map((r) => r.revenue) },
      ],
    });
    C.line($('#chartCpl'), {
      labels, values: rows.map((r) => r.cpl), cls: 'cpl', fmt: axisMoney, tip, height: 150,
      ariaLabel: 'Cost per lead by month',
    });
    C.columns($('#chartLeads'), {
      labels, fmt: (v) => int(v), tip, height: 150,
      ariaLabel: 'Leads per month',
      series: [{ name: 'Leads', cls: 'leads', values: rows.map((r) => r.leads) }],
    });
  }

  function channelTable(s) {
    const maxRev = Math.max(1, ...s.channels.map((c) => c.revenue));
    const notes = {
      other: 'Sponsorships, promo items and vendors with no lead trail',
      shows: (state.events || []).filter((e) => e.channel === 'shows').map((e) => `${e.name}: true cost ${money(e.cost)}, charged by leads`).join('') || '',
      unknown: 'Rep-created deals with no lead source: referrals, repeat clients. Not marketing.',
    };
    const k = state.sort.key;
    const rows = s.channels.slice().sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      if (k === 'name') return state.sort.dir * a.name.localeCompare(b.name);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return state.sort.dir * (av - bv);
    });
    const cols = [
      ['name', 'Channel'], ['spend', 'Spend'], ['leads', 'Leads'], ['killedRate', 'Killed at phone'], ['cpl', 'Cost / lead'],
      ['qcpl', 'Qualified CPL'], ['jobs', 'Jobs'], ['closeRate', 'Lead → job'], ['revenue', 'Job revenue'], ['roas', 'Return'],
    ];
    const maturing = state.basis !== 'closed' && s.months.some((m) => !M.isMatured(m, state.data.generatedAt));
    const th = cols.map(([key, label]) => `<th data-key="${key}" ${key === k ? `aria-sort="${state.sort.dir < 0 ? 'descending' : 'ascending'}"` : ''}>${label}</th>`).join('');
    const body = rows.map((c) => `
      <tr>
        <td><span class="ch-name">${esc(c.name)}</span><span data-rowflag="channel|${esc(c.id)}">${rowFlag('channel', c.id)}</span>${notes[c.id] ? `<span class="ch-note">${notes[c.id]}</span>` : ''}${c.viaTraffic ? `<span class="ch-note">incl. ${c.viaTraffic} credited by website traffic source</span>` : ''}${c.wonNoAspire ? `<span class="ch-note">+${c.wonNoAspire} won without Aspire #</span>` : ''}</td>
        <td>${c.spend ? money(c.spend) : '—'}</td>
        <td>${c.overhead ? '—' : int(c.leads)}</td>
        <td>${c.overhead || !c.leads ? '—' : pct(c.killedRate)}</td>
        <td>${c.cpl == null ? '—' : money(c.cpl)}</td>
        <td>${c.qcpl == null ? '—' : money(c.qcpl)}</td>
        <td>${c.overhead ? '—' : int(c.jobs)}</td>
        <td>${c.overhead ? '—' : pct(c.closeRate, 1)}</td>
        <td><div class="rev-cell">${c.overhead ? '—' : money(c.revenue)}<span class="rev-bar" aria-hidden="true"><span style="width:${(c.revenue / maxRev * 100).toFixed(1)}%"></span></span></div></td>
        <td>${c.overhead ? '<span class="pill flat">no leads</span>' : c.spend ? retPill(c.roas, maturing) : '<span class="pill flat">no spend</span>'}</td>
      </tr>`).join('');
    const t = s.total;
    return `<table class="channels">
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Total</td><td>${money(t.spend)}</td><td>${int(t.leads)}</td><td>${pct(t.killedRate)}</td><td>${money(t.cpl)}</td><td>${money(t.qcpl)}</td><td>${int(t.jobs)}</td>
        <td>${pct(t.closeRate, 1)}</td><td>${money(t.revenue)}</td><td>${retPill(t.roas, maturing)}</td>
      </tr></tfoot>
    </table>
    ${maturing ? '<p class="muted small">* Return includes lead months under 90 days old, which are still maturing. The standards judge return on matured months only; see the Return on spend tile.</p>' : ''}`;
  }

  function serviceLineTable(lines) {
    const maxRev = Math.max(1, ...lines.map((l) => l.revenue));
    const body = lines.map((l) => `
      <tr data-line="${esc(l.id)}" tabindex="0" class="clickable${state.serviceLine === l.id ? ' selected' : ''}" aria-pressed="${state.serviceLine === l.id}">
        <td><span class="ch-name">${esc(l.name)}</span><span data-rowflag="line|${esc(l.id)}">${rowFlag('line', l.id)}</span>${l.id === 'none' ? '<span class="ch-note">Deals with no “Type of Job”</span>' : ''}</td>
        <td>${int(l.leads)}</td>
        <td>${pct(l.marketingShare)}</td>
        <td>${int(l.jobs)}</td>
        <td>${pct(l.closeRate, 1)}</td>
        <td>${money(l.avgJob)}</td>
        <td><div class="rev-cell">${money(l.revenue)}<span class="rev-bar" aria-hidden="true"><span style="width:${(l.revenue / maxRev * 100).toFixed(1)}%"></span></span></div></td>
        <td>${l.spend ? money(l.spend) : '—'}</td>
        <td>${l.cpl == null ? '—' : money(l.cpl)}</td>
        <td>${l.spend ? retPill(l.roas) : '<span class="pill flat">—</span>'}</td>
      </tr>`).join('');
    return `<table class="channels lines">
      <thead><tr><th>Service line</th><th>Leads</th><th title="Share of all deals in this line that have a lead source (or a paid/organic traffic source)">Has lead source</th><th>Jobs</th><th>Lead → job</th><th>Avg job</th><th>Job revenue</th><th>Est. spend</th><th>Est. cost / lead</th><th>Est. return</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderWeb() {
    const box = $('#webBars');
    const w = M.summarizeWeb(state.data.web, state.from, state.to);
    if (!w.rows.length) {
      box.innerHTML = '<p class="muted small">No website analytics for this period. Check that the HubSpot private app has the analytics scope (see README).</p>';
      return;
    }
    const rows = w.rows.slice(0, 7).map((r) => (w.hasVisits
      ? { label: esc(r.source), value: r.visits, display: `${int(r.visits)} sessions`, sub: `${int(r.contacts)} new contacts · ${pct(r.visits ? r.contacts / r.visits : null, 1)} conversion` }
      : { label: esc(r.source), value: r.contacts, display: `${int(r.contacts)} contacts` }));
    C.hbars(box, rows);
  }

  function funnelHtml(s) {
    const w = M.summarizeWeb(state.data.web, state.from, state.to);
    const steps = [
      w.hasVisits ? ['Web sessions', w.visits] : null,
      ['New contacts', w.contacts || null],
      ['Leads (deals)', s.total.leads],
      ['Jobs closed', s.total.jobs],
    ].filter((x) => x && x[1] != null);
    const max = Math.max(1, ...steps.map((x) => x[1]));
    let html = '<div class="funnel">';
    const offset = 4 - steps.length; // keep the darkest shade on "Jobs closed"
    steps.forEach(([name, v], i) => {
      const width = Math.max(18, Math.sqrt(v / max) * 100); // sqrt keeps the small steps readable
      html += `<div class="funnel-step"><span class="name">${name}</span><div class="funnel-bar s${i + offset}" style="width:${width.toFixed(1)}%">${int(v)}</div></div>`;
      if (i < steps.length - 1 && v && steps[i + 1][1] <= v) {
        html += `<div class="funnel-rate">↓ ${pct(steps[i + 1][1] / v, 1)}</div>`;
      }
    });
    return html + '</div><p class="muted small" style="margin:12px 0 0">New contacts include website contacts only; leads include phone, show and referral deals too.</p>';
  }

  function attentionHtml(s) {
    const list = s.missingAspire;
    if (!list.length) return '<p class="muted">All Closed Won deals in this period have an Aspire #. 🎉</p>';
    const portal = state.data.portalId;
    const total = list.reduce((a, d) => a + (Number(d.amount) || 0), 0);
    const items = list.slice(0, 6).map((d) => {
      const name = esc(d.name || `Deal ${d.id}`);
      const link = portal && d.id && !String(d.id).startsWith('sample') ? `<a href="https://app.hubspot.com/contacts/${portal}/record/0-3/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${name}</a>` : name;
      return `<li><span>${link}</span><span class="amt">${money(Number(d.amount) || 0)}</span></li>`;
    }).join('');
    return `<div class="big-num num">${int(list.length)} <span class="muted small">deals · ${money(total)}</span></div>
      <p class="muted small" style="margin:4px 0 10px">Not counted as jobs until the Aspire # is filled in on the deal.</p>
      <ul class="attn">${items}</ul>${list.length > 6 ? `<p class="muted small">+ ${list.length - 6} more</p>` : ''}`;
  }

  function spendDetailHtml(s) {
    const byId = Object.fromEntries(state.channels.map((c) => [c.id, c.name]));
    const rows = s.months.map((m) => {
      const r = state.spendByMonth[m];
      const label = r ? (r.basis === 'actual' ? 'Actual' : r.basis === 'partial' ? 'Partly estimated' : 'Budget (estimate)') : 'No data';
      return `<tr><td>${M.monthLabel(m, true)}</td><td>${label}</td><td class="muted">${esc(r ? r.source : '')}</td><td class="num">${money(s.byMonth[m].spend)}</td></tr>`;
    }).join('');
    const vendor = {};
    s.months.forEach((m) => {
      const r = state.spendByMonth[m];
      (r ? r.lines : []).forEach((l) => {
        const key = `${l.channel}|${String(l.label).split(' · ').find((x) => /[a-z]/i.test(x)) || l.label}`;
        vendor[key] = (vendor[key] || 0) + l.amount;
      });
    });
    const vrows = Object.entries(vendor).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, v]) => { const [ch, name] = k.split('|'); return `<tr><td>${esc(name)}</td><td>${esc(byId[ch] || ch)}</td><td class="num">${money(v)}</td></tr>`; }).join('');
    return `<details class="spend-detail">
      <summary>Where the spend numbers come from</summary>
      <div class="grid-2" style="margin-top:8px">
        <div><table><thead><tr><th>Month</th><th>Basis</th><th>Source</th><th class="num">Spend</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div><table><thead><tr><th>Vendor / line item</th><th>Channel</th><th class="num">Total</th></tr></thead><tbody>${vrows}</tbody></table></div>
      </div>
    </details>`;
  }

  load(false);
})();
