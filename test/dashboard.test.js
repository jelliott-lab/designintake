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
  assert.strictEqual(by.excluded, 2410.14, 'HBA amortisation is not working media');
  assert.strictEqual(by.social, 250);
  assert.strictEqual(by.print, -259.43);
  assert.strictEqual(by.other, 500, 'unmatched vendors fall into the default spend channel');
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
    '2026-01': { basis: 'actual', byChannel: { google: 1000, other: 200, excluded: 999 }, lines: [] },
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
  assert.strictEqual(s.total.roas, 8000 / 2200);
  assert.strictEqual(s.excludedSpend, 999, 'software and HBA are left out of spend');
  assert.deepStrictEqual(s.missingAspire.map((d) => d.id), ['c']);
  assert.deepStrictEqual(s.estimatedMonths, ['2026-02']);
  const google = s.channels.find((c) => c.id === 'google');
  assert.strictEqual(google.leads, 3);
  assert.strictEqual(google.jobs, 1);
  assert.strictEqual(google.cpl, 2000 / 3);
  const unknown = s.channels.find((c) => c.id === 'unknown');
  assert.strictEqual(unknown.cpl, null, 'no spend → no CPL');
  assert.strictEqual(s.channels.find((c) => c.id === 'other').overhead, true);
  assert.ok(!s.channels.some((c) => c.id === 'excluded'));

  const closed = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'closed' });
  assert.strictEqual(closed.total.jobs, 3, 'close basis counts the 2025 lead that closed in January');
  assert.strictEqual(closed.byMonth['2026-01'].revenue, 1000);

  const noUnknown = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'cohort', includeUnknown: false });
  assert.strictEqual(noUnknown.total.leads, 3);
  assert.ok(!noUnknown.channels.some((c) => c.id === 'unknown'));

  const p2 = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-02', basis: 'closed', pipeline: 'P2' });
  assert.strictEqual(p2.total.jobs, 1);
});

test('blank lead source falls back to original traffic source', () => {
  const spendByMonth = { '2026-01': { basis: 'actual', byChannel: { google: 600 }, lines: [] } };
  const deal = (o) => Object.assign({ created: '2026-01-10', won: false, aspire: '', amount: 0, source: '', traffic: '' }, o);
  const deals = [
    deal({ id: 'a', source: 'google_ads' }),
    deal({ id: 'b', traffic: 'PAID_SEARCH', won: true, aspire: '1', amount: 1000 }),
    deal({ id: 'c', traffic: 'OFFLINE', won: true, aspire: '2', amount: 5000 }),
    deal({ id: 'd', source: 'organic', traffic: 'PAID_SEARCH' }),
  ];
  const s = M.summarize({ deals, spendByMonth }, { from: '2026-01', to: '2026-01', basis: 'cohort', includeUnknown: false });
  const google = s.channels.find((c) => c.id === 'google');
  assert.strictEqual(google.leads, 2);
  assert.strictEqual(google.viaTraffic, 1);
  assert.strictEqual(google.revenue, 1000);
  assert.strictEqual(s.channels.find((c) => c.id === 'seo').leads, 1, 'a known lead source always wins');
  assert.strictEqual(s.total.leads, 3, 'no-source deal excluded');
  assert.strictEqual(s.total.revenue, 1000);
  assert.deepStrictEqual([s.unattributed.leads, s.unattributed.jobs, s.unattributed.revenue], [1, 1, 5000]);
  assert.strictEqual(s.unattributed.share, 5000 / 6000);
});

test('service line filter splits spend by each channel\'s lead share', () => {
  const spendByMonth = { '2026-01': { basis: 'actual', byChannel: { google: 1000, other: 400 }, lines: [] } };
  const deal = (o) => Object.assign({ created: '2026-01-10', won: false, aspire: '', amount: 0, source: 'google_ads' }, o);
  const deals = [
    deal({ id: 'a', jobType: 'Lawn Care', won: true, aspire: '1', amount: 300 }),
    deal({ id: 'b', jobType: 'Plant Health Care' }),
    deal({ id: 'c', jobType: 'Landscape Design & Install', won: true, aspire: '2', amount: 20000 }),
    deal({ id: 'd', jobType: 'Lawn Care;Enhancement' }),
    deal({ id: 'e', jobType: '', source: '' }),
  ];
  const opts = { from: '2026-01', to: '2026-01', basis: 'cohort', includeUnknown: true };
  const all = M.summarize({ deals, spendByMonth }, opts);
  assert.strictEqual(all.allocated, false);
  assert.strictEqual(all.total.spend, 1400);

  const lpc = M.summarize({ deals, spendByMonth }, Object.assign({}, opts, { serviceLine: 'lpc' }));
  assert.strictEqual(lpc.allocated, true);
  assert.strictEqual(lpc.total.leads, 2);
  // Google: 2 of its 4 leads are LPC → 500. Tools (no leads): 2 of all 5 leads → 160.
  assert.strictEqual(lpc.total.spend, 660);
  assert.strictEqual(lpc.total.revenue, 300);

  const lines = M.summarizeServiceLines({ deals, spendByMonth }, opts);
  const by = Object.fromEntries(lines.map((l) => [l.id, l]));
  assert.strictEqual(by.enhance.leads, 1, 'multi-select counts once, under the earliest service line');
  assert.strictEqual(by.none.leads, 1);
  assert.strictEqual(by.none.marketingShare, 0);
  assert.strictEqual(by.design.avgJob, 20000);
  const spendSum = lines.reduce((a, l) => a + l.spend, 0);
  assert.ok(Math.abs(spendSum - 1400) < 1e-9, 'allocated spend adds back up to the total');
});

test('killed at phone, qualified CPL and 90-day maturity', () => {
  const spendByMonth = {
    '2026-05': { basis: 'actual', byChannel: { google: 1000 }, lines: [] },
    '2026-08': { basis: 'actual', byChannel: { google: 1000 }, lines: [] },
  };
  const deal = (o) => Object.assign({ source: 'google_ads', won: false, aspire: '', amount: 0 }, o);
  const deals = [
    deal({ created: '2026-05-02', killed: true }), deal({ created: '2026-05-03', killed: true }),
    deal({ created: '2026-05-04', won: true, aspire: '1', amount: 6000, closed: '2026-06-01' }), deal({ created: '2026-05-05' }),
    deal({ created: '2026-08-02', won: true, aspire: '2', amount: 9000, closed: '2026-08-20' }),
  ];
  const s = M.summarize({ deals, spendByMonth }, { from: '2026-05', to: '2026-08', basis: 'cohort', asOf: '2026-10-13' });
  const may = s.byMonth['2026-05'];
  assert.strictEqual(may.killedRate, 0.5);
  assert.strictEqual(may.cpl, 250);
  assert.strictEqual(may.qcpl, 500, 'spend ÷ (leads − killed)');
  assert.deepStrictEqual(s.matured.months, ['2026-05', '2026-06'], 'July ended 74 days before Oct 13');
  assert.strictEqual(s.matured.ret, 6, 'return counts matured months only');
  assert.strictEqual(M.isMatured('2026-07', '2026-10-29'), true);
  assert.strictEqual(M.isMatured('2026-07', '2026-10-28'), false);
});

test('event true cost replaces the ledger amount and follows the leads', () => {
  const spendByMonth = {
    '2026-02': { month: '2026-02', basis: 'actual', byChannel: { shows: 1000, google: 50 }, lines: [{ label: 'SWAG', channel: 'shows', amount: 1000 }] },
    '2026-03': { month: '2026-03', basis: 'actual', byChannel: { shows: 2397 }, lines: [] },
  };
  const deals = [
    { created: '2026-02-10', source: 'Home & Garden Show' },
    { created: '2026-03-10', source: 'Home & Garden Show' }, { created: '2026-03-11', source: 'Home & Garden Show' },
    { created: '2026-03-12', source: 'google_ads' },
  ];
  const out = M.applyEventCosts(spendByMonth, deals, [{ channel: 'shows', name: 'Show', cost: 30000, year: 2026 }]);
  assert.strictEqual(out.events[0].ledger, 3397);
  assert.strictEqual(out.spendByMonth['2026-02'].byChannel.shows, 10000);
  assert.strictEqual(out.spendByMonth['2026-03'].byChannel.shows, 20000);
  assert.strictEqual(out.spendByMonth['2026-02'].byChannel.google, 50);
  assert.strictEqual(spendByMonth['2026-02'].byChannel.shows, 1000, 'input untouched');
});

// ---- standards triggers ----
const F = require('../dashboard/public/flags.js');

function standardsCtx(extra) {
  return Object.assign({ asOf: '2026-10-13T15:00:00', currentMonth: '2026-10', spendByMonth: {}, deals: [] }, extra);
}
const many = (n, o) => Array.from({ length: n }, (_, i) => Object.assign({ id: `d${i}-${Math.random()}`, won: false, aspire: '', amount: 0 }, typeof o === 'function' ? o(i) : o));

test('CS-1 fires on two matured months under 3.0×, and not below the sample floor', () => {
  // As of Oct 13, June (ended 104 days earlier) is the latest matured month, so the window is May–June.
  const spend = { '2026-05': { month: '2026-05', byChannel: { google: 5000 } }, '2026-06': { month: '2026-06', byChannel: { google: 5000 } } };
  const deals = [
    ...many(12, (i) => ({ created: '2026-05-10', source: 'google_ads', won: i === 0, aspire: i === 0 ? '1' : '', amount: i === 0 ? 10000 : 0 })),
    ...many(12, (i) => ({ created: '2026-06-10', source: 'google_ads', won: i === 0, aspire: i === 0 ? '2' : '', amount: i === 0 ? 5000 : 0 })),
  ];
  const r = F.evaluate(standardsCtx({ deals, spendByMonth: spend }));
  const f = r.flags.find((x) => x.rule === 'CS-1');
  assert.ok(f, 'CS-1 flagged');
  assert.strictEqual(f.id, 'CS-1:google:2026-06');
  assert.match(f.detail, /May 2026: 2\.0×.*Jun 2026: 1\.0×/);
  assert.strictEqual(r.register.find((x) => x.id === 'CS-1').status, 'breach');

  const thin = F.evaluate(standardsCtx({ deals: deals.slice(0, 15), spendByMonth: spend }));
  assert.ok(!thin.flags.some((x) => x.rule === 'CS-1'));
  assert.strictEqual(thin.register.find((x) => x.id === 'CS-1').status, 'insufficient', 'below 20 leads reads insufficient, not red');
});

test('CS-4 untraceable spend, LQ-1/2/3 lead quality, DH-5 ledger lag', () => {
  const spend = {
    '2026-08': { month: '2026-08', byChannel: { print: 900, google: 100 } },
    '2026-09': { month: '2026-09', byChannel: { print: 700, google: 100 } },
  };
  const deals = many(40, (i) => ({
    created: '2026-09-15', source: 'google_ads', lost: i < 30,
    killed: i < 24, lostReason: i < 4 ? 'Out of Service Area' : i < 18 ? 'Unqualified with Approval' : i < 30 ? 'Price' : '',
  }));
  const r = F.evaluate(standardsCtx({ deals, spendByMonth: spend, ledgerMonth: '2026-07' }));
  const ids = r.flags.map((f) => f.id);
  assert.ok(ids.includes('CS-4:print:2026-09'));
  assert.ok(ids.includes(`LQ-1:google:${F.isoWeek(new Date('2026-10-13T15:00:00'))}`), 'killed 60% > 55%');
  assert.ok(ids.some((id) => id.startsWith('LQ-2:google')), 'OOSA 10% > 8%');
  assert.ok(ids.some((id) => id.startsWith('LQ-3:google')), 'UwA 35% > 30%');
  assert.ok(ids.includes('DH-5:2026-10'), 'July ledger is 74 days behind');
  const reg = Object.fromEntries(r.register.map((x) => [x.id, x.status]));
  assert.strictEqual(reg['SC-4'], 'not-measured');
  assert.strictEqual(reg['DH-4'], 'manual');
  assert.strictEqual(reg['CS-5'], 'manual');
});

test('SC-1 speed to first touch uses business hours and the overnight rule', () => {
  const rules = F.DEFAULT_RULES;
  // Tue 9:00 → Tue 13:30 is 4.5 business hours.
  assert.strictEqual(F.firstTouchOverdue(new Date('2026-10-13T09:00:00'), new Date('2026-10-13T13:30:00'), rules), true);
  assert.strictEqual(F.firstTouchOverdue(new Date('2026-10-13T09:00:00'), new Date('2026-10-13T12:30:00'), rules), false);
  // Fri 16:00 → Mon 10:00 is 3 business hours (1 Fri + 2 Mon).
  assert.strictEqual(F.firstTouchOverdue(new Date('2026-10-09T16:00:00'), new Date('2026-10-12T10:00:00'), rules), false);
  // Overnight: Mon 19:00 → due Tue 10:00.
  assert.strictEqual(F.firstTouchOverdue(new Date('2026-10-12T19:00:00'), new Date('2026-10-13T09:59:00'), rules), false);
  assert.strictEqual(F.firstTouchOverdue(new Date('2026-10-12T19:00:00'), new Date('2026-10-13T10:01:00'), rules), true);
  // Saturday → due Monday 10:00.
  assert.strictEqual(F.firstTouchOverdue(new Date('2026-10-10T11:00:00'), new Date('2026-10-12T09:00:00'), rules), false);

  const deals = [
    { id: 'w1', name: 'Waiting', created: '2026-10-12', source: 'organic', open: true, stage: 'New Lead', stageEntered: '2026-10-12T09:00:00' },
    { id: 'w2', name: 'Self', created: '2026-10-12', source: '', open: true, stage: 'New Lead', stageEntered: '2026-10-12T09:00:00' },
  ];
  const r = F.evaluate(standardsCtx({ deals }));
  const f = r.flags.find((x) => x.rule === 'SC-1');
  assert.deepStrictEqual(f.deals, ['w1'], 'self-sourced deals are not marketing leads');
});

test('SC-2 stage stall and SC-3 cycle drift', () => {
  const deals = [
    { id: 's1', created: '2026-08-01', open: true, stage: 'Contract Sent', stageDays: 25, owner: 'Ann' },
    { id: 's2', created: '2026-08-01', open: true, stage: 'Contract Sent', stageDays: 10, owner: 'Ann' },
    { id: 's3', created: '2026-08-01', open: true, stage: 'Long Term Project', stageDays: 300 },
    ...many(16, (i) => ({ created: '2026-07-01', closed: '2026-08-15', won: true, daysToClose: 30 + i, designPath: false })),
  ];
  const r = F.evaluate(standardsCtx({ deals }));
  const sc2 = r.flags.find((x) => x.rule === 'SC-2');
  assert.deepStrictEqual(sc2.deals, ['s1'], 'only stages with a dwell limit; Contract Sent limit is 18 days');
  const sc3 = r.flags.filter((x) => x.rule === 'SC-3').map((x) => x.id);
  assert.deepStrictEqual(sc3.sort(), ['SC-3:all:2026-10', 'SC-3:other:2026-10']);
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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => Object.assign({}, props),
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        getAll: (ks) => Object.fromEntries(ks.filter((k) => k in cache).map((k) => [k, cache[k]])),
        putAll: (vals) => Object.assign(cache, vals),
      }),
    },
    Session: { getScriptTimeZone: () => 'America/New_York', getActiveUser: () => ({ getEmail: () => 'jon@precisiongvl.com' }) },
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
    if (url.endsWith('/crm/v3/pipelines/deals')) {
      return resp(200, { results: [{ id: '840356670', label: 'Official Sales Pipeline', stages: [
        { id: '101', label: 'New Lead', metadata: { isClosed: 'false', probability: '0.1' } },
        { id: '102', label: 'Appointment Scheduled', metadata: { isClosed: 'false', probability: '0.2' } },
        { id: '103', label: 'Design Phase', metadata: { isClosed: 'false', probability: '0.4' } },
        { id: '107', label: 'Closed Won', metadata: { isClosed: 'true', probability: '1.0' } },
        { id: '108', label: 'Closed Lost', metadata: { isClosed: 'true', probability: '0.0' } },
      ] }] });
    }
    if (url.includes('/crm/v3/owners')) return resp(200, { results: [{ id: '77', firstName: 'Ann', lastName: 'Rep' }] });
    if (url.includes('/analytics/v2/reports/sources/monthly')) {
      return resp(200, { '2026-03-01': [{ breakdown: 'PAID_SEARCH', visits: 120, contacts: 9 }, { breakdown: 'OFFLINE', visits: 0, contacts: 900 }] });
    }
    if (url.endsWith('/crm/v3/objects/deals/search')) {
      const body = JSON.parse(opts.payload);
      assert.strictEqual(body.filterGroups.length, 3, 'created OR closed since start, OR still open');
      assert.ok(body.properties.includes('hs_v2_date_entered_103') && body.properties.includes('hs_v2_cumulative_time_in_101'), 'stage history requested');
      const props = {
        dealname: 'Smith patio', createdate: '2026-03-04T12:00:00Z', closedate: '2026-04-01T00:00:00Z', hs_is_closed_won: 'true', hs_is_closed: 'true',
        hs_is_closed_lost: 'false', aspire_opportunity: '4521', amount_in_home_currency: '12000', known_lead_source: 'google_ads', pipeline: '840356670',
        hs_analytics_source: 'PAID_SEARCH', type_of_job: 'Enhancement', dealstage: '107', hubspot_owner_id: '77', days_to_close: '28',
        hs_v2_date_entered_102: '2026-03-05T00:00:00Z', hs_v2_date_entered_103: '2026-03-10T00:00:00Z', hs_v2_cumulative_time_in_101: '5400000',
        hs_v2_date_entered_current_stage: '2026-04-01T00:00:00Z', hs_object_source_label: 'FORM',
      };
      const lost = {
        dealname: 'Tire kicker', createdate: '2026-03-06T12:00:00Z', closedate: '2026-03-07T00:00:00Z', hs_is_closed_won: 'false', hs_is_closed: 'true',
        hs_is_closed_lost: 'true', closed_lost_reason: 'Out of Service Area', known_lead_source: 'google_ads', pipeline: '840356670', dealstage: '108',
        hs_v2_date_entered_108: '2026-03-07T00:00:00Z', hs_object_source_label: 'CRM_UI',
      };
      if (!body.after) return resp(200, { results: [{ id: '1', properties: props }], paging: { next: { after: '1' } } });
      return resp(200, { results: [{ id: '2', properties: lost }] });
    }
    return resp(404, { message: 'unexpected ' + url });
  });
  const data = JSON.parse(gs.getDashboardData(false));
  assert.deepStrictEqual(data.warnings, []);
  assert.strictEqual(data.deals.length, 2);
  const { stageDays, ...won } = data.deals[0];
  assert.ok(stageDays > 100, 'days since entering the current stage');
  assert.deepStrictEqual(won, {
    id: '1', name: 'Smith patio', created: '2026-03-04', closed: '2026-04-01', won: true, aspire: '4521',
    amount: 12000, source: 'google_ads', sourceLabel: 'Google Ads', pipeline: 'Official Sales Pipeline',
    traffic: 'PAID_SEARCH', jobType: 'Enhancement', stage: 'Closed Won', open: false, lost: false, lostReason: '',
    killed: false, designPath: true, firstTouchMs: 5400000, stageEntered: '2026-04-01T00:00:00Z', daysToClose: 28,
    owner: 'Ann Rep', repCreated: false,
  });
  const l = data.deals[1];
  assert.deepStrictEqual([l.aspire, l.lost, l.killed, l.lostReason, l.designPath, l.repCreated, l.firstTouchMs], ['', true, true, 'Out of Service Area', false, true, null], 'lost without passing New Lead = killed at phone');
  assert.strictEqual(data.config.eventCosts[0].cost, 30000);
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

test('Code.gs keeps a shared accept / override decision log', () => {
  const { gs } = loadCodeGs({}, () => resp(500, {}));
  assert.deepStrictEqual(JSON.parse(gs.getReviews()), {});
  assert.throws(() => gs.saveReview('CS-4:print:2026-09', 'overridden', '  '), /needs a reason/);
  assert.throws(() => gs.saveReview('bad id!', 'accepted', ''), /Invalid flag id/);
  gs.saveReview('CS-4:print:2026-09', 'overridden', 'Fall mailer still landing', 'CS-4: Print');
  let r = JSON.parse(gs.saveReview('CS-4:print:2026-09', 'open', ''))['CS-4:print:2026-09'];
  assert.strictEqual(r.decision, null);
  r = JSON.parse(gs.saveReview('CS-4:print:2026-09', 'accepted', 'Cutting print'))['CS-4:print:2026-09'];
  assert.strictEqual(r.decision, 'accepted');
  assert.strictEqual(r.by, 'jon@precisiongvl.com');
  assert.strictEqual(r.title, 'CS-4: Print');
  assert.deepStrictEqual(r.history.map((h) => h.decision), ['overridden', 'open', 'accepted'], 'history is kept for the override count');
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
  for (const f of ['styles.css', 'metrics.js', 'flags.js', 'charts.js', 'app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../dashboard/public', f), 'utf8');
    assert.ok(html.includes(src.replace(/<\/script/gi, '<\\/script')), `${f} is stale — run npm run build:dashboard`);
  }
  assert.ok(!html.includes('sample-data'), 'sample data is not shipped');
});
