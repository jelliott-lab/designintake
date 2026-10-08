// Shared, DOM-free dashboard math: parses the spend sheet, maps spend and leads to channels,
// and computes CPL / ROI for a period. Loaded in the browser as window.Metrics and in Node
// tests via require(). Months are 'YYYY-MM' strings throughout.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Metrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Each channel ties together:
  //  - leadSources: HubSpot "Known lead source" values or labels (case-insensitive)
  //  - budgetItems: row names on the spend sheet's budget tab
  //  - vendors:     regexes matched against QuickBooks transaction Name/Num/Description
  //  - windsor:     Windsor.ai data source ids (optional)
  //  - traffic:     HubSpot "Original Traffic Source" values used when Known lead source is blank
  // Spend that matches nothing lands in the channel marked defaultSpend; leads whose source
  // matches nothing land in the channel marked defaultLeads.
  const DEFAULT_CHANNELS = [
    {
      id: 'google', name: 'Google Ads',
      leadSources: ['google_ads', 'Google Ads', 'Google Ads [Survey]'],
      budgetItems: ['Google PPC Ads', 'Google Local Service Ads'],
      vendors: ['google\\s*\\*?\\s*ads'],
      windsor: ['google_ads'],
      traffic: ['PAID_SEARCH'],
    },
    {
      id: 'seo', name: 'SEO & website',
      leadSources: ['organic', 'Organic', 'WordPress Site'],
      budgetItems: ['Landscape Leadership'],
      vendors: ['landscape leadership', 'godaddy'],
      traffic: ['ORGANIC_SEARCH'],
    },
    {
      id: 'shows', name: 'Home & Garden Show',
      leadSources: ['Home & Garden Show'],
      budgetItems: ['HBA Invoice Payoff', 'SWAG for Events'],
      vendors: ['\\bhba\\b'],
    },
    {
      id: 'social', name: 'Social media',
      leadSources: ['social_media', 'Social Media'],
      budgetItems: ['Social Media Boosts'],
      vendors: ['\\bmeta\\b', 'facebook', 'facebk', 'instagram'],
      windsor: ['facebook'],
      traffic: ['PAID_SOCIAL', 'SOCIAL_MEDIA'],
    },
    {
      id: 'print', name: 'Direct mail & print',
      leadSources: ['direct_mail', 'Direct Mail'],
      budgetItems: ['Print Materials'],
      vendors: ['vista\\s*print', '\\bmoo\\b', 'fedex', 'print\\s*fast', 'minuteman', 'postal service', '\\busps\\b', 'mailers?\\b'],
    },
    {
      id: 'tools', name: 'Tools, events & other',
      budgetItems: ['Hubspot', 'Call Rail', 'Misc', 'AI Ads?'],
      vendors: ['hubspot', 'call\\s*rail', 'mailchimp', 'buzzsprout'],
      defaultSpend: true,
    },
    {
      id: 'unknown', name: 'Referral / no source',
      leadSources: [''],
      defaultLeads: true,
    },
  ];

  // Service lines group HubSpot "Type of Job" values. Deals with no Type of Job land in the
  // line marked defaultLine.
  const DEFAULT_SERVICE_LINES = [
    { id: 'design', name: 'Design & build', jobTypes: ['Landscape Design & Install'] },
    { id: 'enhance', name: 'Enhancements', jobTypes: ['Enhancement'] },
    { id: 'maint', name: 'Maintenance & gardening', jobTypes: ['Maintenance & Gardening'] },
    { id: 'lpc', name: 'Lawn & plant care (LPC)', jobTypes: ['Lawn Care', 'Plant Health Care', 'Exterior Pest Control'] },
    { id: 'irrigation', name: 'Irrigation', jobTypes: ['Irrigation Services'] },
    { id: 'none', name: 'Type of job not set', jobTypes: [''], defaultLine: true },
  ];

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // ---- small helpers ---------------------------------------------------------

  function parseMoney(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    let s = String(v).trim();
    if (!s) return null;
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^\$\s*-/.test(s);
    s = s.replace(/[()$,\s-]/g, '');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    return neg ? -n : n;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const monthKey = (y, m) => `${y}-${pad(m)}`; // m is 1-based

  function monthOf(dateLike) {
    if (!dateLike) return null;
    const s = String(dateLike);
    let m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
    m = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})/);
    if (m) return monthKey(m[2], +m[1]);
    return null;
  }

  function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const i = y * 12 + (m - 1) + n;
    return monthKey(Math.floor(i / 12), (i % 12) + 1);
  }

  function monthRange(from, to) {
    const out = [];
    for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
    return out;
  }

  function monthLabel(month, long) {
    const [y, m] = month.split('-').map(Number);
    const name = new Date(y, m - 1, 1).toLocaleString('en-US', { month: long ? 'long' : 'short' });
    return long ? `${name} ${y}` : name;
  }

  // "Jan", "March 26", "April 2026", "Updated April", "Sept" → month number (1-12) and maybe a year.
  function parseMonthName(text) {
    const s = String(text || '').toLowerCase();
    const m = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep)[a-z]*\b|\b(oct|nov|dec)[a-z]*\b/);
    if (!m) return null;
    const month = MONTHS.indexOf((m[1] || m[2]).slice(0, 3)) + 1;
    const y = s.match(/\b(20\d{2})\b/) || s.match(/\b(\d{2})\s*$/);
    let year = y ? +y[1] : null;
    if (year != null && year < 100) year += 2000;
    return { month, year };
  }

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

  // ---- channels --------------------------------------------------------------

  function makeChannelIndex(channels) {
    channels = channels || DEFAULT_CHANNELS;
    const bySource = {};
    const byItem = {};
    const byWindsor = {};
    const byTraffic = {};
    const vendorRules = [];
    let defaultSpend = null;
    let defaultLeads = null;
    channels.forEach((c) => {
      (c.leadSources || []).forEach((s) => { bySource[norm(s)] = c.id; });
      (c.budgetItems || []).forEach((s) => { byItem[norm(s)] = c.id; });
      (c.windsor || []).forEach((s) => { byWindsor[norm(s)] = c.id; });
      (c.traffic || []).forEach((s) => { byTraffic[norm(s)] = c.id; });
      (c.vendors || []).forEach((re) => vendorRules.push({ re: new RegExp(re, 'i'), id: c.id }));
      if (c.defaultSpend) defaultSpend = c.id;
      if (c.defaultLeads) defaultLeads = c.id;
    });
    defaultSpend = defaultSpend || channels[channels.length - 1].id;
    defaultLeads = defaultLeads || channels[channels.length - 1].id;
    return {
      channels,
      byId: Object.fromEntries(channels.map((c) => [c.id, c])),
      defaultLeads,
      forSource: (value, label) => bySource[norm(value)] || bySource[norm(label)] || defaultLeads,
      // Known lead source first; when it's blank, fall back to the original traffic source.
      attribute(deal) {
        const known = bySource[norm(deal.source)] || bySource[norm(deal.sourceLabel)];
        if (known && known !== defaultLeads) return { id: known, viaTraffic: false };
        if (!norm(deal.source)) {
          const t = byTraffic[norm(deal.traffic)];
          if (t) return { id: t, viaTraffic: true };
        }
        return { id: known || defaultLeads, viaTraffic: false };
      },
      forItem: (item) => byItem[norm(item)] || defaultSpend,
      forWindsor: (src) => byWindsor[norm(src)] || null,
      forVendor(text) {
        const hit = vendorRules.find((r) => r.re.test(text));
        return hit ? hit.id : defaultSpend;
      },
    };
  }

  function makeLineIndex(lines) {
    lines = lines || DEFAULT_SERVICE_LINES;
    const byType = {};
    lines.forEach((l) => (l.jobTypes || []).forEach((t) => { byType[norm(t)] = l.id; }));
    const fallback = (lines.find((l) => l.defaultLine) || lines[lines.length - 1]).id;
    const order = lines.map((l) => l.id);
    return {
      lines,
      // "Type of Job" is multi-select ("A;B"). A deal counts once, under whichever of its types
      // comes first in the service line list, so revenue is never double-counted.
      forType(jobType) {
        const ids = String(jobType || '').split(';').map((t) => byType[norm(t)]).filter(Boolean);
        if (!ids.length) return fallback;
        return ids.sort((x, y) => order.indexOf(x) - order.indexOf(y))[0];
      },
    };
  }

  // ---- spend sheet -----------------------------------------------------------

  // Budget tab: row 1 has month names over Budget/Actual column pairs, row 2 has
  // "Item, Budget, Actual, ...", then one row per line item until "Total".
  function parseBudgetTab(values, year) {
    const rows = [];
    if (!values || values.length < 3) return rows;
    const hdrRow = values.findIndex((r) => r && norm(r[0]) === 'item');
    if (hdrRow < 1) return rows;
    const monthsRow = values[hdrRow - 1];
    const sub = values[hdrRow];
    const cols = []; // { month, budgetCol, actualCol }
    let current = null;
    for (let c = 1; c < sub.length; c++) {
      const label = String(monthsRow[c] || '').trim();
      if (label) {
        const pm = /total/i.test(label) ? null : parseMonthName(label);
        current = pm ? { month: monthKey(pm.year || year, pm.month) } : null;
        if (current) cols.push(current);
      }
      if (!current) continue;
      if (norm(sub[c]) === 'budget') current.budgetCol = c;
      if (norm(sub[c]) === 'actual') current.actualCol = c;
    }
    for (let r = hdrRow + 1; r < values.length; r++) {
      const item = String(values[r][0] || '').trim();
      if (!item) continue;
      if (/^total/i.test(item)) break;
      cols.forEach((col) => {
        rows.push({
          item,
          month: col.month,
          budget: col.budgetCol != null ? parseMoney(values[r][col.budgetCol]) : null,
          actual: col.actualCol != null ? parseMoney(values[r][col.actualCol]) : null,
        });
      });
    }
    return rows;
  }

  // QuickBooks "Transaction Report" tab. Finds the header row (has "Amount" and a date column),
  // then keeps every row whose date parses. Returns { month, lines: [{ date, text, amount }] }.
  function parseTransactionTab(values, tabName, year) {
    if (!values || !values.length) return null;
    let hdr = -1;
    let dateCol = -1;
    let amountCol = -1;
    for (let r = 0; r < Math.min(values.length, 15) && hdr < 0; r++) {
      const row = values[r].map(norm);
      const a = row.indexOf('amount');
      const d = row.findIndex((v) => v === 'date' || v === 'transaction date');
      if (a >= 0 && d >= 0) { hdr = r; amountCol = a; dateCol = d; }
    }
    if (hdr < 0) return null;
    const textCols = [];
    values[hdr].forEach((h, i) => {
      if (/^(num|name|memo\/description|description|memo)$/.test(norm(h))) textCols.push(i);
    });
    const lines = [];
    for (let r = hdr + 1; r < values.length; r++) {
      const row = values[r];
      const date = row[dateCol];
      const month = date instanceof Date ? monthKey(date.getFullYear(), date.getMonth() + 1) : monthOf(date);
      const amount = parseMoney(row[amountCol]);
      if (!month || amount == null) continue;
      lines.push({ month, text: textCols.map((i) => row[i]).filter(Boolean).join(' · '), amount });
    }
    if (!lines.length) return null;
    // The tab is "for" the month most of its lines fall in (tab names are inconsistent).
    const counts = {};
    lines.forEach((l) => { counts[l.month] = (counts[l.month] || 0) + 1; });
    let month = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const named = parseMonthName(tabName);
    if (named) month = monthKey(named.year || +month.slice(0, 4) || year, named.month);
    return { tab: tabName, month, lines };
  }

  // tabs: [{ name, values }]. Returns the parsed budget rows and one transaction tab per month.
  // When two tabs cover the same month, one named "Updated …" wins, otherwise the later tab.
  function parseSpendWorkbook(tabs, opts) {
    opts = opts || {};
    const year = opts.year || new Date().getFullYear();
    const budgetTabName = norm(opts.budgetTab || `${year} budget`);
    let budget = [];
    const txnByMonth = {};
    (tabs || []).forEach((t) => {
      if (norm(t.name) === budgetTabName || (!budget.length && /budget/i.test(t.name))) {
        const rows = parseBudgetTab(t.values, year);
        if (rows.length) { budget = rows; return; }
      }
      const parsed = parseTransactionTab(t.values, t.name, year);
      if (!parsed) return;
      const prev = txnByMonth[parsed.month];
      if (prev && /updated/i.test(prev.tab) && !/updated/i.test(parsed.tab)) return;
      txnByMonth[parsed.month] = parsed;
    });
    return { budget, transactions: txnByMonth };
  }

  // Spend per month and channel. For each month, the best available source wins:
  //   1. QuickBooks transactions tab for that month   (basis 'actual')
  //   2. "Actual" column on the budget tab             (basis 'actual')
  //   3. Windsor.ai platform spend, plus budget for non-ad items  (basis 'partial')
  //   4. "Budget" column                                (basis 'budget' — an estimate)
  function buildSpend(workbook, opts) {
    opts = opts || {};
    const idx = opts.index || makeChannelIndex(opts.channels);
    const windsor = opts.windsor || [];
    const out = {}; // month → { basis, source, byChannel: {id: amount}, lines: [] }
    const months = new Set();
    workbook.budget.forEach((r) => months.add(r.month));
    Object.keys(workbook.transactions).forEach((m) => months.add(m));
    windsor.forEach((w) => months.add(w.month));

    months.forEach((month) => {
      const add = (rec, id, amt) => { rec.byChannel[id] = (rec.byChannel[id] || 0) + amt; };
      const txn = workbook.transactions[month];
      const budgetRows = workbook.budget.filter((r) => r.month === month);
      const rec = { month, byChannel: {}, lines: [] };
      if (txn) {
        rec.basis = 'actual';
        rec.source = `QuickBooks tab “${txn.tab}”`;
        txn.lines.forEach((l) => {
          const id = idx.forVendor(l.text);
          add(rec, id, l.amount);
          rec.lines.push({ label: l.text, channel: id, amount: l.amount });
        });
      } else if (budgetRows.some((r) => r.actual != null && r.actual !== 0)) {
        rec.basis = 'actual';
        rec.source = 'Budget tab, Actual column';
        budgetRows.forEach((r) => {
          if (!r.actual) return;
          add(rec, idx.forItem(r.item), r.actual);
          rec.lines.push({ label: r.item, channel: idx.forItem(r.item), amount: r.actual });
        });
      } else {
        const w = windsor.filter((x) => x.month === month && idx.forWindsor(x.source));
        const windsorChannels = new Set(w.map((x) => idx.forWindsor(x.source)));
        rec.basis = w.length ? 'partial' : 'budget';
        rec.source = w.length ? 'Windsor.ai ad spend + budget for everything else' : 'Budget tab, Budget column (estimate)';
        w.forEach((x) => {
          add(rec, idx.forWindsor(x.source), x.spend || 0);
          rec.lines.push({ label: `${x.source} (Windsor)`, channel: idx.forWindsor(x.source), amount: x.spend || 0 });
        });
        budgetRows.forEach((r) => {
          const id = idx.forItem(r.item);
          if (!r.budget || windsorChannels.has(id)) return;
          add(rec, id, r.budget);
          rec.lines.push({ label: `${r.item} (budget)`, channel: id, amount: r.budget });
        });
      }
      out[month] = rec;
    });
    return out;
  }

  // ---- deals → per-month, per-channel facts ----------------------------------

  // deal: { id, name, created, closed, won, aspire, amount, source, sourceLabel, pipeline }
  // A "job" is a Closed Won deal with an Aspire Opportunity # filled in.
  const isJob = (d) => d.won && String(d.aspire || '').trim() !== '';

  // ---- summary for a period --------------------------------------------------

  const safeDiv = (a, b) => (b ? a / b : null);

  // opts: { from, to, pipeline ('all' or name), serviceLine ('all' or id), basis ('cohort' | 'closed'),
  //         includeUnknown (count deals with no lead source), channels, serviceLines }
  //
  // Spend isn't tagged by pipeline or service line, so when either filter is set each channel's
  // spend for a month is split by that channel's share of the month's leads (overhead and
  // lead-less channels by the month's overall share). Those figures come back with allocated: true.
  function summarize(data, opts) {
    const idx = makeChannelIndex(opts.channels || (data.config && data.config.channels));
    const lineIdx = makeLineIndex(opts.serviceLines || (data.config && data.config.serviceLines));
    const months = monthRange(opts.from, opts.to);
    const inRange = (m) => m && m >= opts.from && m <= opts.to;
    const spendByMonth = data.spendByMonth || buildSpend(data.workbook, { index: idx, windsor: data.windsor });
    const unknownId = idx.defaultLeads;
    const byPipeline = !opts.pipeline || opts.pipeline === 'all';
    const byLine = !opts.serviceLine || opts.serviceLine === 'all';
    const matches = (d) => (byPipeline || d.pipeline === opts.pipeline) && (byLine || lineIdx.forType(d.jobType) === opts.serviceLine);
    const allocated = !byPipeline || !byLine;

    const all = (data.deals || []).map((d) => {
      const a = idx.attribute(d);
      return { d, ch: a.id, viaTraffic: a.viaTraffic, created: monthOf(d.created), closed: monthOf(d.closed), keep: matches(d) };
    });

    const blank = () => ({ spend: 0, leads: 0, jobs: 0, revenue: 0, wonNoAspire: 0, viaTraffic: 0 });
    const byChannel = Object.fromEntries(idx.channels.map((c) => [c.id, blank()]));
    const byMonth = Object.fromEntries(months.map((m) => [m, blank()]));
    const total = blank();
    const unattributed = { leads: 0, jobs: 0, revenue: 0 };
    let allRevenue = 0;
    const missingAspire = [];

    // Lead counts per month × channel, all deals vs. the filtered slice, for spend allocation.
    const share = {};
    if (allocated) {
      all.forEach((x) => {
        if (!inRange(x.created)) return;
        const k = x.created;
        const r = share[k] || (share[k] = { all: 0, mine: 0, ch: {} });
        const c = r.ch[x.ch] || (r.ch[x.ch] = { all: 0, mine: 0 });
        r.all++; c.all++;
        if (x.keep) { r.mine++; c.mine++; }
      });
    }
    const spendShare = (m, id) => {
      if (!allocated) return 1;
      const r = share[m];
      if (!r || !r.all) return 0;
      const c = r.ch[id];
      return c && c.all ? c.mine / c.all : r.mine / r.all;
    };

    months.forEach((m) => {
      const rec = spendByMonth[m];
      if (!rec) return;
      Object.entries(rec.byChannel).forEach(([id, amt]) => {
        const v = amt * spendShare(m, id);
        if (!byChannel[id]) byChannel[id] = blank();
        byChannel[id].spend += v;
        byMonth[m].spend += v;
        total.spend += v;
      });
    });

    all.forEach(({ d, ch, viaTraffic, created, closed, keep }) => {
      if (!keep) return;
      const counted = opts.includeUnknown !== false || ch !== unknownId;
      const revMonth = opts.basis === 'closed' ? closed : created;
      const job = d.won && isJob(d) && inRange(revMonth);
      const amt = Number(d.amount) || 0;
      if (ch === unknownId) {
        if (inRange(created)) unattributed.leads++;
        if (job) { unattributed.jobs++; unattributed.revenue += amt; }
      }
      if (job) allRevenue += amt;
      if (!counted) return;
      if (inRange(created)) {
        byChannel[ch].leads++;
        byMonth[created].leads++;
        total.leads++;
        if (viaTraffic) { byChannel[ch].viaTraffic++; total.viaTraffic++; }
      }
      if (d.won && inRange(revMonth)) {
        if (job) {
          byChannel[ch].jobs++; byChannel[ch].revenue += amt;
          byMonth[revMonth].jobs++; byMonth[revMonth].revenue += amt;
          total.jobs++; total.revenue += amt;
        } else {
          byChannel[ch].wonNoAspire++;
          total.wonNoAspire++;
          missingAspire.push(d);
        }
      }
    });

    const derive = (r) => Object.assign(r, {
      cpl: r.spend ? safeDiv(r.spend, r.leads) : null,
      costPerJob: r.spend ? safeDiv(r.spend, r.jobs) : null,
      closeRate: safeDiv(r.jobs, r.leads),
      avgJob: safeDiv(r.revenue, r.jobs),
      roi: r.spend ? (r.revenue - r.spend) / r.spend : null,
      roas: r.spend ? safeDiv(r.revenue, r.spend) : null,
    });
    derive(total);
    Object.values(byChannel).forEach(derive);
    Object.values(byMonth).forEach(derive);
    unattributed.share = safeDiv(unattributed.revenue, allRevenue);

    const estimatedMonths = months.filter((m) => !spendByMonth[m] || spendByMonth[m].basis !== 'actual');

    return {
      months,
      total,
      byMonth,
      allocated,
      unattributed,
      channels: idx.channels
        .filter((c) => opts.includeUnknown !== false || c.id !== unknownId)
        .map((c) => Object.assign({ id: c.id, name: c.name, overhead: !c.leadSources }, byChannel[c.id])),
      spendByMonth,
      estimatedMonths,
      missingAspire: missingAspire.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)),
    };
  }

  // One summary per service line (same period and filters), for the service line table.
  function summarizeServiceLines(data, opts) {
    const lineIdx = makeLineIndex(opts.serviceLines || (data.config && data.config.serviceLines));
    return lineIdx.lines.map((l) => {
      const s = summarize(data, Object.assign({}, opts, { serviceLine: l.id }));
      const inc = opts.includeUnknown !== false;
      const allLeads = inc ? s.total.leads : s.total.leads + s.unattributed.leads;
      const marketingShare = safeDiv(allLeads - s.unattributed.leads, allLeads);
      return Object.assign({ id: l.id, name: l.name, marketingShare, unattributed: s.unattributed }, s.total);
    });
  }

  // Previous period of the same length, for the deltas on the KPI tiles.
  function previousPeriod(from, to) {
    const n = monthRange(from, to).length;
    return { from: addMonths(from, -n), to: addMonths(from, -1) };
  }

  // Web analytics rows ({ month, source, visits, contacts }) summed by source for the period.
  function summarizeWeb(web, from, to) {
    const by = {};
    (web || []).forEach((w) => {
      if (w.month < from || w.month > to) return;
      const r = by[w.source] || (by[w.source] = { source: w.source, visits: null, contacts: 0 });
      if (w.visits != null) r.visits = (r.visits || 0) + w.visits;
      r.contacts += w.contacts || 0;
    });
    const rows = Object.values(by).sort((a, b) => (b.visits || 0) - (a.visits || 0) || b.contacts - a.contacts);
    const hasVisits = rows.some((r) => r.visits != null);
    return {
      rows,
      hasVisits,
      visits: hasVisits ? rows.reduce((s, r) => s + (r.visits || 0), 0) : null,
      contacts: rows.reduce((s, r) => s + r.contacts, 0),
    };
  }

  // Period presets relative to the current month. "Complete" presets stop at last month so a
  // half-finished month (with spend but few leads yet) doesn't skew CPL.
  function presets(currentMonth) {
    const last = addMonths(currentMonth, -1);
    const year = currentMonth.slice(0, 4);
    const firstOfYear = `${year}-01`;
    return [
      { id: 'ytd_complete', label: 'Year to date (full months)', from: firstOfYear, to: last >= firstOfYear ? last : currentMonth },
      { id: 'ytd', label: 'Year to date (incl. this month)', from: firstOfYear, to: currentMonth },
      { id: 'last_month', label: 'Last month', from: last, to: last },
      { id: 'last_3', label: 'Last 3 full months', from: addMonths(currentMonth, -3), to: last },
      { id: 'this_month', label: 'This month so far', from: currentMonth, to: currentMonth },
      { id: 'last_12', label: 'Last 12 full months', from: addMonths(currentMonth, -12), to: last },
    ];
  }

  return {
    DEFAULT_CHANNELS,
    DEFAULT_SERVICE_LINES,
    makeLineIndex,
    summarizeServiceLines,
    parseMoney,
    monthOf,
    addMonths,
    monthRange,
    monthLabel,
    parseMonthName,
    makeChannelIndex,
    parseBudgetTab,
    parseTransactionTab,
    parseSpendWorkbook,
    buildSpend,
    isJob,
    summarize,
    previousPeriod,
    summarizeWeb,
    presets,
  };
});
