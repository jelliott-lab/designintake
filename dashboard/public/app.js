// Marketing dashboard UI. Data comes from Code.gs via google.script.run when hosted on Apps
// Script, or from window.SAMPLE_DATA when the page is opened locally for a preview.
(function () {
  const M = window.Metrics;
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
  const roiText = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100).toLocaleString('en-US')}%`);
  const roas = (v) => (v == null ? '—' : `${v.toFixed(1)}×`);

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

  function prepare(data) {
    state.data = data;
    state.channels = (data.config && data.config.channels) || M.DEFAULT_CHANNELS;
    state.serviceLines = (data.config && data.config.serviceLines) || M.DEFAULT_SERVICE_LINES;
    const workbook = data.workbook || M.parseSpendWorkbook(data.spendTabs || [], { year: data.year, budgetTab: data.budgetTab });
    state.spendByMonth = data.spendByMonth || M.buildSpend(workbook, { channels: state.channels, windsor: data.windsor });
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
    from, to, pipeline: state.pipeline, serviceLine: state.serviceLine, basis: state.basis,
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

    app.innerHTML = `
      ${noticesHtml(s)}
      <section class="kpis-hero" aria-label="Headline numbers">${heroKpis(s, hasPrev ? prev : null)}</section>
      <section class="kpis-small" aria-label="More numbers">${smallKpis(s, hasPrev ? prev : null)}</section>
      <section class="grid-2">
        <div class="card">
          <div class="card-head">
            <div><h2>Spend vs. job revenue</h2><div class="sub">${esc(periodName(state.from, state.to))} · by ${state.basis === 'closed' ? 'close' : 'lead'} month</div></div>
            <div class="legend"><span class="spend"><i></i>Marketing spend</span><span class="revenue"><i></i>Job revenue</span></div>
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
        <div class="table-wrap">${serviceLineTable()}</div>
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
    return [
      { label: 'Cost per lead', value: money(t.cpl), est, d: delta(t.cpl, p && p.total.cpl, true), note: `${int(t.leads)} leads` },
      { label: 'Marketing ROI', value: roiText(t.roi), est, d: delta(t.roi, p && p.total.roi, false, 'pts'), note: `${roas(t.roas)} return on ad spend` },
      { label: state.includeUnknown ? 'Job revenue' : 'Marketing job revenue', value: moneyShort(t.revenue), d: delta(t.revenue, p && p.total.revenue), note: `${int(t.jobs)} jobs with an Aspire #` },
      { label: 'Marketing spend', value: moneyShort(t.spend), est, d: delta(t.spend, p && p.total.spend, true), note: money(t.spend) },
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
      { label: 'Leads', value: int(t.leads), d: delta(t.leads, p && p.total.leads) },
      { label: 'Jobs closed', value: int(t.jobs), d: delta(t.jobs, p && p.total.jobs) },
      { label: 'Lead → job rate', value: pct(t.closeRate, 1), d: delta(t.closeRate, p && p.total.closeRate, false, 'pts') },
      { label: 'Cost per job', value: money(t.costPerJob), d: delta(t.costPerJob, p && p.total.costPerJob, true) },
      { label: 'Avg job value', value: money(t.avgJob), d: delta(t.avgJob, p && p.total.avgJob) },
      {
        label: 'Revenue with no lead source', cls: 'gap', value: moneyShort(s.unattributed.revenue),
        d: `<span class="delta flat">${pct(s.unattributed.share)} of all job revenue · ${int(s.unattributed.jobs)} jobs</span>`,
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
      return `<h4>${M.monthLabel(m, true)}${b !== 'actual' ? ' <span class="est">est.</span>' : ''}</h4>
        <div class="row"><span><i style="background:var(--series-spend)"></i>Spend</span><span>${money(r.spend)}</span></div>
        <div class="row"><span><i style="background:var(--series-revenue)"></i>Job revenue</span><span>${money(r.revenue)}</span></div>
        <div class="row"><span>Leads</span><span>${int(r.leads)}</span></div>
        <div class="row"><span>Jobs</span><span>${int(r.jobs)}</span></div>
        <div class="row"><span>Cost per lead</span><span>${money2(r.cpl)}</span></div>
        <div class="row"><span>ROI</span><span>${roiText(r.roi)}</span></div>`;
    };
    C.columns($('#chartSpendRev'), {
      labels, fmt: axisMoney, tip, height: 400,
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

  function roiPill(v) {
    if (v == null) return '<span class="pill flat">—</span>';
    return `<span class="pill ${v >= 0 ? 'good' : 'bad'}">${roiText(v)}</span>`;
  }

  function channelTable(s) {
    const maxRev = Math.max(1, ...s.channels.map((c) => c.revenue));
    const notes = {
      tools: 'HubSpot, CallRail, sponsorships & other costs with no lead source',
      unknown: 'Deals with no “Known lead source”: referrals, repeat clients, walk-ins',
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
      ['name', 'Channel'], ['spend', 'Spend'], ['leads', 'Leads'], ['cpl', 'Cost / lead'], ['jobs', 'Jobs'],
      ['closeRate', 'Lead → job'], ['costPerJob', 'Cost / job'], ['revenue', 'Job revenue'], ['roi', 'ROI'],
    ];
    const th = cols.map(([key, label]) => `<th data-key="${key}" ${key === k ? `aria-sort="${state.sort.dir < 0 ? 'descending' : 'ascending'}"` : ''}>${label}</th>`).join('');
    const body = rows.map((c) => `
      <tr>
        <td><span class="ch-name">${esc(c.name)}</span>${notes[c.id] ? `<span class="ch-note">${notes[c.id]}</span>` : ''}${c.viaTraffic ? `<span class="ch-note">incl. ${c.viaTraffic} credited by website traffic source</span>` : ''}${c.wonNoAspire ? `<span class="ch-note">+${c.wonNoAspire} won without Aspire #</span>` : ''}</td>
        <td>${c.spend ? money(c.spend) : '—'}</td>
        <td>${c.overhead ? '—' : int(c.leads)}</td>
        <td>${c.cpl == null ? '—' : money(c.cpl)}</td>
        <td>${c.overhead ? '—' : int(c.jobs)}</td>
        <td>${c.overhead ? '—' : pct(c.closeRate, 1)}</td>
        <td>${c.costPerJob == null ? '—' : money(c.costPerJob)}</td>
        <td><div class="rev-cell">${c.overhead ? '—' : money(c.revenue)}<span class="rev-bar" aria-hidden="true"><span style="width:${(c.revenue / maxRev * 100).toFixed(1)}%"></span></span></div></td>
        <td>${c.overhead ? '<span class="pill flat">in total</span>' : c.spend ? roiPill(c.roi) : '<span class="pill flat">no spend</span>'}</td>
      </tr>`).join('');
    const t = s.total;
    return `<table class="channels">
      <thead><tr>${th}</tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <td>Total</td><td>${money(t.spend)}</td><td>${int(t.leads)}</td><td>${money(t.cpl)}</td><td>${int(t.jobs)}</td>
        <td>${pct(t.closeRate, 1)}</td><td>${money(t.costPerJob)}</td><td>${money(t.revenue)}</td><td>${roiPill(t.roi)}</td>
      </tr></tfoot>
    </table>`;
  }

  function serviceLineTable() {
    const lines = M.summarizeServiceLines(summaryData(), Object.assign(summaryOpts(state.from, state.to), { serviceLine: 'all' }));
    const maxRev = Math.max(1, ...lines.map((l) => l.revenue));
    const body = lines.map((l) => `
      <tr data-line="${esc(l.id)}" tabindex="0" class="clickable${state.serviceLine === l.id ? ' selected' : ''}" aria-pressed="${state.serviceLine === l.id}">
        <td><span class="ch-name">${esc(l.name)}</span>${l.id === 'none' ? '<span class="ch-note">Deals with no “Type of Job”</span>' : ''}</td>
        <td>${int(l.leads)}</td>
        <td>${pct(l.marketingShare)}</td>
        <td>${int(l.jobs)}</td>
        <td>${pct(l.closeRate, 1)}</td>
        <td>${money(l.avgJob)}</td>
        <td><div class="rev-cell">${money(l.revenue)}<span class="rev-bar" aria-hidden="true"><span style="width:${(l.revenue / maxRev * 100).toFixed(1)}%"></span></span></div></td>
        <td>${l.spend ? money(l.spend) : '—'}</td>
        <td>${l.cpl == null ? '—' : money(l.cpl)}</td>
        <td>${l.spend ? roiPill(l.roi) : '<span class="pill flat">—</span>'}</td>
      </tr>`).join('');
    return `<table class="channels lines">
      <thead><tr><th>Service line</th><th>Leads</th><th title="Share of all deals in this line that have a lead source (or a paid/organic traffic source)">Has lead source</th><th>Jobs</th><th>Lead → job</th><th>Avg job</th><th>Job revenue</th><th>Est. spend</th><th>Est. cost / lead</th><th>Est. ROI</th></tr></thead>
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
