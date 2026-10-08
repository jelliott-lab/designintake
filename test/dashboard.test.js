const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const M = require('../dashboard/public/metrics.js');

const BUDGET = [
  ['', 'Jan', '', 'Feb', '', 'March', '', 'TOTALS', '', '', ''],
  ['Item', 'Budget', 'Actual', 'Budget', 'Actual', 'Budget', 'Actual', 'Budget', 'Actual', 'Difference', 'Projected'],
  ['Landscape Leadership', '$7,833.33', '$7,833.00', '$7,833.33', '$7,833.00', '$7,833.33', '', '$23,499.99', '', '', ''],
  ['Google PPC Ads', '$0.00', '$6,066.25', '$4,000.00', '$4,300.64', '$13,700.00', '', '', '', '', ''],
  ['Hubspot', '$1,611.20', '$1,611.20', '$1,611.20', '', '$1,611.20', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', '', ''],
  ['Total:', '$9,444.53', '$15,510.45', '', '', '', '', '', '', '', ''],
];

// Same shape as the QuickBooks "Transaction Report" tabs on the real sheet.
const TXN_FEB = [
  ['Precision Landscape', '', '', '', '', '', '', '', '', ''],
  ['Transaction Report', '', '', '', '', '', '', '', '', ''],
  ['February 2026', '', '', '', '', '', '', '', '', ''],
  ['', 'Date', 'Transaction Type', 'Num', 'Name', 'Memo/Description', 'Account', 'Split', ' Amount ', 'Balance'],
  ['7310 Advertising/Promotional', '', '', '', '', '', '', '', '', ''],
  ['', '02/01/2026', 'Bill', '3675', 'Landscape Leadership', 'monthly marketing services', '7310', 'A/P', '7,187.00', '7,187.00'],
  ['', '02/02/2026', 'Expense', 'Google*Ads', 'Google ADSXXXX3258', '', '7310', 'Card', '$1,000.00', '8,187.00'],
  ['', '02/03/2026', 'Journal Entry', 'HBA Amort - FEB', 'Amortization of HBA prepaid', '', '7310', '', '2,410.14', '10,597.14'],
  ['', '02/05/2026', 'Expense', 'EEP74', 'Meta - Facebook/Instagram', '', '7310', 'Card', '250', '10,847.14'],
  ['', '02/06/2026', 'Credit Card Credit', 'Moo Inc.', 'Moo Print', '', '7310', 'Card', '-259.43', '10,587.71'],
  ['', '02/07/2026', 'Expense', '8074077', 'Greenville Drive, LLC', '', '7310', 'Card', '500', '11,087.71'],
  ['Total for 7310 Advertising/Promotional', '', '', '', '', '', '', '', '$11,087.71', ''],
];

test('parseMoney handles sheet formats', () => {
  assert.strictEqual(M.parseMoney('$7,833.33'), 7833.33);
  assert.strictEqual(M.parseMoney('-$6,750.55'), -6750.55);
  assert.strictEqual(M.parseMoney('(259.43)'), -259.43);
  assert.strictEqual(M.parseMoney(' $ 23,206.27 '), 23206.27);
  assert.strictEqual(M.parseMoney(''), null);
  assert.strictEqual(M.parseMoney('Budget'), null);
});

test('parseMonthName reads the tab names used on the sheet', () => {
  assert.deepStrictEqual(M.parseMonthName('Jan 26'), { month: 1, year: 2026 });
  assert.deepStrictEqual(M.parseMonthName('April 2026'), { month: 4, year: 2026 });
  assert.deepStrictEqual(M.parseMonthName('Updated April'), { month: 4, year: null });
  assert.deepStrictEqual(M.parseMonthName('Sept'), { month: 9, year: null });
  assert.strictEqual(M.parseMonthName('2026 Budget'), null);
});

test('budget tab parses into item × month rows, stopping at Total', () => {
  const rows = M.parseBudgetTab(BUDGET, 2026);
  assert.strictEqual(rows.length, 9); // 3 items × 3 months, TOTALS columns ignored
  const ppcJan = rows.find((r) => r.item === 'Google PPC Ads' && r.month === '2026-01');
  assert.deepStrictEqual(ppcJan, { item: 'Google PPC Ads', month: '2026-01', budget: 0, actual: 6066.25 });
  assert.strictEqual(rows.find((r) => r.item === 'Hubspot' && r.month === '2026-02').actual, null);
});

test('transaction tab classifies vendors into channels', () => {
  const tab = M.parseTransactionTab(TXN_FEB, 'Feb 26', 2026);
  assert.strictEqual(tab.month, '2026-02');
  assert.strictEqual(tab.lines.length, 6, 'only dated rows with amounts');
  const idx = M.makeChannelIndex();
  const by = {};
  tab.lines.forEach((l) => { const id = idx.forVendor(l.text); by[id] = (by[id] || 0) + l.amount; });
  assert.strictEqual(by.seo, 7187);
  assert.strictEqual(by.google, 1000);
  assert.strictEqual(by.shows, 2410.14);
  assert.strictEqual(by.social, 250);
  assert.strictEqual(by.print, -259.43);
  assert.strictEqual(by.tools, 500, 'unmatched vendors fall into the default spend channel');
});

test('workbook prefers transactions, then budget actuals, then budget', () => {
  const april = TXN_FEB.map((r) => r.map((c) => String(c).replace('02/', '04/')));
  const aprilUpdated = april.map((r) => r.slice());
  aprilUpdated[6][8] = '$3,000.00';
  const wb = M.parseSpendWorkbook([
    { name: '2026 Budget', values: BUDGET },
    { name: 'Feb 26', values: TXN_FEB },
    { name: 'Updated April', values: aprilUpdated },
    { name: 'April 2026', values: april },
  ], { year: 2026, budgetTab: '2026 Budget' });
  assert.deepStrictEqual(Object.keys(wb.transactions).sort(), ['2026-02', '2026-04']);
  assert.strictEqual(wb.transactions['2026-04'].tab, 'Updated April', '"Updated" tab wins');

  const spend = M.buildSpend(wb, {});
  assert.strictEqual(spend['2026-01'].basis, 'actual');
  assert.strictEqual(spend['2026-01'].source, 'Budget tab, Actual column');
  assert.strictEqual(spend['2026-01'].byChannel.google, 6066.25);
  assert.strictEqual(spend['2026-02'].basis, 'actual');
  assert.ok(/QuickBooks/.test(spend['2026-02'].source), 'transactions beat the budget tab actuals');
  assert.strictEqual(spend['2026-02'].byChannel.google, 1000);
  assert.strictEqual(spend['2026-03'].basis, 'budget');
  assert.strictEqual(spend['2026-03'].byChannel.google, 13700);
  assert.strictEqual(spend['2026-04'].byChannel.google, 3000);

  const withWindsor = M.buildSpend(wb, { windsor: [{ month: '2026-03', source: 'google_ads', spend: 9000 }] });
  assert.strictEqual(withWindsor['2026-03'].basis, 'partial');
  assert.strictEqual(withWindsor['2026-03'].byChannel.google, 9000, 'Windsor replaces the Google budget');
  assert.strictEqual(withWindsor['2026-03'].byChannel.seo, 7833.33, 'budget still fills the rest');
});

test('summarize computes CPL, jobs (Aspire # required) and ROI', () => {
  const spendByMonth = {
    '2026-01': { basis: 'actual', byChannel: { google: 1000, tools: 200 }, lines: [] },
    '2026-02': { basis: 'budget', byChannel: { google: 1000 }, lines: [] },
  };
  const deal = (o) => Object.assign({ id: 'x', created: '2026-01-10', closed: null, won: false, aspire: '', amount: 0, source: 'google_ads', pipeline: 'P1' }, o);
  const deals = [
    deal({ id: 'a' }),
    deal({ id: 'b', won: true, aspire: '123', amount: 5000, closed: '2026-02-03' }),
    deal({ id: 'c', won: true, aspire: '', amount: 9999, closed: '2026-01-20' }),
    deal({ id: 'd', source: '', created: '2026-02-01', won: true, aspire: '9', amount: 3000, closed: '2026-02-10' }),
    deal({ id: 'e', created: '2025-12-15', won: true, aspire: '7', amount: 1000, closed: '2026-01-05', pipeline: 'P2' }),
  ];
  const s = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'cohort' });
  assert.strictEqual(s.total.spend, 2200);
  assert.strictEqual(s.total.leads, 4);
  assert.strictEqual(s.total.cpl, 550);
  assert.strictEqual(s.total.jobs, 2, 'won without Aspire # is not a job; 2025 lead not in cohort');
  assert.strictEqual(s.total.revenue, 8000);
  assert.strictEqual(s.total.roi, (8000 - 2200) / 2200);
  assert.deepStrictEqual(s.missingAspire.map((d) => d.id), ['c']);
  assert.deepStrictEqual(s.estimatedMonths, ['2026-02']);
  const google = s.channels.find((c) => c.id === 'google');
  assert.strictEqual(google.leads, 3);
  assert.strictEqual(google.jobs, 1);
  assert.strictEqual(google.cpl, 2000 / 3);
  const unknown = s.channels.find((c) => c.id === 'unknown');
  assert.strictEqual(unknown.cpl, null, 'no spend → no CPL');
  assert.strictEqual(s.channels.find((c) => c.id === 'tools').overhead, true);

  const closed = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'closed' });
  assert.strictEqual(closed.total.jobs, 3, 'close basis counts the 2025 lead that closed in January');
  assert.strictEqual(closed.byMonth['2026-01'].revenue, 1000);

  const noUnknown = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'cohort', includeUnknown: false });
  assert.strictEqual(noUnknown.total.leads, 3);
  assert.ok(!noUnknown.channels.some((c) => c.id === 'unknown'));

  const p2 = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'closed', pipeline: 'P2' });
  assert.strictEqual(p2.total.jobs, 1);
});

test('periods and presets', () => {
  assert.deepStrictEqual(M.previousPeriod('2026-01', '2026-03'), { from: '2025-10', to: '2025-12' });
  const ytd = M.presets('2026-10').find((p) => p.id === 'ytd_complete');
  assert.deepStrictEqual([ytd.from, ytd.to], ['2026-01', '2026-09']);
  const jan = M.presets('2026-01').find((p) => p.id === 'ytd_complete');
  assert.deepStrictEqual([jan.from, jan.to], ['2026-01', '2026-01']);
});

// ---- Code.gs against mocked Apps Script services ----

function loadCodeGs(props, fetchImpl) {
  const cache = {};
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        getAll: (ks) => Object.fromEntries(ks.filter((k) => k in cache).map((k) => [k, cache[k]])),
        putAll: (vals) => Object.assign(cache, vals),
      }),
    },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: {
      sleep() {},
      formatDate: (d, tz, f) => f.replace('yyyy', d.getFullYear()).replace('MM', String(d.getMonth() + 1).padStart(2, '0')).replace('dd', String(d.getDate()).padStart(2, '0')),
    },
    SpreadsheetApp: {
      openById: (id) => ({
        getSheets: () => [{ getName: () => '2026 Budget', getDataRange: () => ({ getDisplayValues: () => BUDGET }) }],
        id,
      }),
    },
    HtmlService: {},
    UrlFetchApp: { fetch: (url, opts) => fetchImpl(url, opts) },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dashboard/apps-script/Code.gs'), 'utf8'), ctx);
  return { gs: ctx, cache };
}

const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });

test('Code.gs pulls deals, labels, pipelines, web analytics and the spend sheet', () => {
  const calls = [];
  const { gs, cache } = loadCodeGs({ HUBSPOT_TOKEN: 'tok' }, (url, opts) => {
    calls.push(url);
    assert.strictEqual(opts.headers.Authorization, 'Bearer tok');
    if (url.endsWith('/crm/v3/properties/deals/known_lead_source')) return resp(200, { options: [{ value: 'google_ads', label: 'Google Ads' }] });
    if (url.endsWith('/crm/v3/pipelines/deals')) return resp(200, { results: [{ id: '840356670', label: 'Official Sales Pipeline' }] });
    if (url.includes('/analytics/v2/reports/sources/monthly')) {
      return resp(200, { '2026-03-01': [{ breakdown: 'PAID_SEARCH', visits: 120, contacts: 9 }, { breakdown: 'OFFLINE', visits: 0, contacts: 900 }] });
    }
    if (url.endsWith('/crm/v3/objects/deals/search')) {
      const body = JSON.parse(opts.payload);
      assert.strictEqual(body.filterGroups.length, 2, 'created OR closed since start');
      const props = { dealname: 'Smith patio', createdate: '2026-03-04T12:00:00Z', closedate: '2026-04-01T00:00:00Z', hs_is_closed_won: 'true', aspire_opportunity: '4521', amount_in_home_currency: '12000', known_lead_source: 'google_ads', pipeline: '840356670' };
      if (!body.after) return resp(200, { results: [{ id: '1', properties: props }], paging: { next: { after: '1' } } });
      return resp(200, { results: [{ id: '2', properties: Object.assign({}, props, { hs_is_closed_won: 'false', aspire_opportunity: null }) }] });
    }
    return resp(404, { message: 'unexpected ' + url });
  });
  const data = JSON.parse(gs.getDashboardData(false));
  assert.deepStrictEqual(data.warnings, []);
  assert.strictEqual(data.deals.length, 2);
  assert.deepStrictEqual(data.deals[0], {
    id: '1', name: 'Smith patio', created: '2026-03-04', closed: '2026-04-01', won: true, aspire: '4521',
    amount: 12000, source: 'google_ads', sourceLabel: 'Google Ads', pipeline: 'Official Sales Pipeline',
  });
  assert.strictEqual(data.deals[1].aspire, '');
  assert.deepStrictEqual(data.web, [{ month: '2026-03', source: 'Paid search', visits: 120, contacts: 9 }], 'offline sources dropped');
  assert.strictEqual(data.spendTabs[0].name, '2026 Budget');
  assert.strictEqual(data.portalId, 50709738);

  // Second call is served from the cache.
  const n = calls.length;
  assert.ok(cache.dash_n);
  assert.strictEqual(gs.getDashboardData(false), JSON.stringify(data));
  assert.strictEqual(calls.length, n);
  gs.getDashboardData(true);
  assert.ok(calls.length > n, 'refresh bypasses the cache');
});

test('Code.gs reports missing setup and API failures as warnings instead of crashing', () => {
  const { gs } = loadCodeGs({}, () => resp(500, {}));
  const data = JSON.parse(gs.getDashboardData(true));
  assert.ok(data.warnings.some((w) => /HUBSPOT_TOKEN/.test(w)));
  assert.strictEqual(data.spendTabs.length, 1, 'spend sheet still loads');

  const { gs: gs2 } = loadCodeGs({ HUBSPOT_TOKEN: 't' }, () => resp(403, { message: 'missing scopes' }));
  const d2 = JSON.parse(gs2.getDashboardData(true));
  assert.ok(d2.warnings.some((w) => /HubSpot deals.*403.*missing scopes/.test(w)));
});

test('dashboard Apps Script build is up to date with dashboard/public', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dashboard/apps-script/Index.html'), 'utf8');
  for (const f of ['styles.css', 'metrics.js', 'charts.js', 'app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../dashboard/public', f), 'utf8');
    assert.ok(html.includes(src.replace(/<\/script/gi, '<\\/script')), `${f} is stale — run npm run build:dashboard`);
  }
  assert.ok(!html.includes('sample-data'), 'sample data is not shipped');
});
