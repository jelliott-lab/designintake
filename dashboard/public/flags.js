// Review flags, driven by the "Marketing Standards & Trigger System" doc.
//
// Every standard has a trigger (a number plus a window and a minimum sample) and a recommended
// action. Nothing acts on its own: a tripped trigger becomes a flag with the evidence attached,
// and someone accepts the recommendation or overrides it with a reason. Below a rule's sample
// floor it reads "insufficient data", never red.
//
// evaluate(ctx) → { register: [...one row per rule...], flags: [...findings to decide on...] }
// Flag ids carry the rule's window (week, month or quarter), so a trigger that keeps firing
// asks for a fresh decision each cycle, matching the rule's cadence.
//
// DOM-free; loaded in the browser as window.Flags and in Node tests via require().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./metrics.js'));
  else root.Flags = factory(root.Metrics);
})(typeof self !== 'undefined' ? self : this, function (M) {
  // Thresholds from the standards doc. Override any of them with CONFIG.flagRules in Code.gs;
  // per the doc, every threshold change also gets a line in its change log.
  const DEFAULT_RULES = {
    cs1MinReturn: 3.0, cs1MinLeads: 20,
    cs2Ratio: 1.4, cs2MinLeads: 15, cs2Months: 6,
    cs3MinReturn: 8.0, cs3MinLeads: 20,
    cs4MinSpend: 500,
    cs5Ratio: 1.2,
    cs6Share: 0.6, cs6WatchShare: 0.5,
    sc1Hours: 4, sc1NextDayHour: 10, sc1MinPerWeek: 3,
    businessStart: 8, businessEnd: 17,
    stallDays: { 'New Lead': 4 / 24, 'Appointment Scheduled': 16, 'Design Phase': 28, Estimating: 14, Presenting: 11, 'Contract Sent': 18, Revisions: 13 },
    sc3Ratio: 1.3, sc3MinWon: 15, sc3Baseline: { all: 19, design: 32, other: 16 },
    lqWindowDays: 60, lq1Rate: 0.55, lq1MinLeads: 30,
    lq2Rate: 0.08, lq3Rate: 0.30, lqMinLeads: 30, // LQ-2/3 state no floor; LQ-1's is used
    lq4Rate: 0.12, lq4WindowDays: 91, lq4MinLost: 20, // floor assumed: 20 lost leads
    lq5Rate: 0.05, lq5MinLeads: 20, // floor assumed: 20 leads
    dh1Rate: 0.95, dh1MinDeals: 20,
    dh5Days: 45,
    overrideLimit: 3,
    // Dashboard checks (not in the standards doc)
    missingAspireMin: 1, noJobTypeShare: 0.1, unmatchedSpendMin: 1000, overBudgetRatio: 1.2, overBudgetMin: 1000,
  };

  // The trigger register, as written in the standards doc.
  const REGISTER = [
    ['CS-1', 'Sustained low return', 'Return under 3.0× for two matured months, 20+ leads', 'Monthly', 'Jon'],
    ['CS-2', 'Cost per lead breakout', 'Qualified CPL over 140% of its six-month average, two months', 'Monthly', 'Marketing manager'],
    ['CS-3', 'Scale up', 'Return over 8.0× for two matured months, flat qualified CPL', 'Monthly', 'Jon'],
    ['CS-4', 'Untraceable spend', 'Over $500 a month with zero attributable leads, two months', 'Monthly', 'Marketing manager'],
    ['CS-5', 'One-off event costing', 'True event cost over 120% of ledger cost', 'Per event', 'Jon'],
    ['CS-6', 'Concentration', 'One channel over 60% of marketing leads for a quarter', 'Quarterly', 'Jon'],
    ['SC-1', 'Speed to first touch', 'Lead in New Lead over four business hours', 'Daily', 'Office manager'],
    ['SC-2', 'Stage stall', 'Open deal over twice its stage’s median dwell', 'Weekly', 'Sales manager'],
    ['SC-3', 'Total cycle drift', '90-day median days-to-close over 130% of baseline', 'Monthly', 'Jon'],
    ['SC-4', 'Cold quote', 'Aspire quote over 90 days past proposed date', 'Weekly', 'Sales manager'],
    ['SC-5', 'Quote-to-close collapse', 'Division quote-to-close down 15+ points for a quarter', 'Quarterly', 'Jon'],
    ['LQ-1', 'Killed-at-phone rate', 'Killed at phone over 55%, rolling 60 days, 30+ leads', 'Weekly', 'Marketing manager'],
    ['LQ-2', 'Out of service area', 'Out of Service Area over 8% of channel leads, rolling 60 days', 'Weekly', 'Marketing manager'],
    ['LQ-3', 'Unqualified with approval', 'Unqualified with Approval over 30% of channel leads, rolling 60 days', 'Weekly', 'Marketing manager'],
    ['LQ-4', 'Unable to contact', 'Unable to Contact over 12% of channel losses, rolling quarter', 'Quarterly', 'Sales manager'],
    ['LQ-5', 'Spam and duplicates', 'Spam plus duplicates over 5% of channel leads in a month', 'Monthly', 'Marketing manager'],
    ['DH-1', 'Lead source population', 'Known lead source on under 95% of new deals in a month', 'Monthly', 'Office manager'],
    ['DH-2', 'HubSpot record before Aspire job', 'Aspire job with no HubSpot deal', 'Weekly', 'Office manager'],
    ['DH-3', 'Aspire lost disposition', 'Aspire Lost on under 80% of dead opportunities', 'Monthly', 'Sales manager'],
    ['DH-4', 'Offline channel instrumentation', 'Offline spend launched with no tracking', 'Pre-launch', 'Marketing manager'],
    ['DH-5', 'Spend ledger timeliness', 'Advertising ledger over 45 days behind', 'Monthly', 'Jon'],
    ['DH-6', 'Reconciliation residual', 'Aspire-to-HubSpot revenue waterfall residual not zero', 'Per report', 'Jon'],
  ].map(([id, name, trigger, cadence, owner]) => ({ id, name, trigger, cadence, owner }));

  const NEEDS_ASPIRE = ['SC-4', 'SC-5', 'DH-2', 'DH-3', 'DH-6'];
  // The standards run return on Aspire won dollars; until Aspire is connected the dashboard uses
  // HubSpot deal amounts on Closed Won deals with an Aspire #, which can read lower.
  const REVENUE_CAVEAT = 'Revenue is HubSpot deal amounts, not Aspire won dollars: confirm in Aspire before moving budget.';
  const STATUS_ORDER = { breach: 0, watch: 1, gap: 2, opportunity: 3, insufficient: 4, green: 5, manual: 6, 'not-measured': 7 };
  const SEVERITY_ORDER = { breach: 0, watch: 1, opportunity: 2, info: 3 };

  // ---- small helpers ----
  const money = (v) => (v == null ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
  const pct = (v) => `${Math.round(v * 100)}%`;
  const x = (v) => `${v.toFixed(1)}×`;
  const mlabel = (m) => {
    const [y, mo] = m.split('-').map(Number);
    return new Date(y, mo - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  };
  const median = (arr) => {
    const a = arr.filter((v) => v != null && isFinite(v)).sort((p, q) => p - q);
    if (!a.length) return null;
    const i = Math.floor(a.length / 2);
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  };
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / 864e5 + 1) / 7)).padStart(2, '0')}`;
  }
  const quarterOf = (m) => `${m.slice(0, 4)}-Q${Math.floor((+m.slice(5, 7) - 1) / 3) + 1}`;
  const hours = (ms) => ms / 36e5;
  const fmtHours = (h) => (h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} hours` : `${(h / 24).toFixed(1)} days`);

  // Business hours (Mon–Fri, start–end, viewer's local time ≈ Eastern) between two instants.
  function businessHoursBetween(a, b, r) {
    let total = 0;
    const d = new Date(a);
    d.setHours(0, 0, 0, 0);
    for (; d < b; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd === 0 || wd === 6) continue;
      const open = new Date(d); open.setHours(r.businessStart, 0, 0, 0);
      const close = new Date(d); close.setHours(r.businessEnd, 0, 0, 0);
      const s = Math.max(open, a);
      const e = Math.min(close, b);
      if (e > s) total += (e - s) / 36e5;
    }
    return total;
  }
  function inBusinessHours(t, r) {
    const wd = t.getDay();
    return wd !== 0 && wd !== 6 && t.getHours() >= r.businessStart && t.getHours() < r.businessEnd;
  }
  // SC-1: four business hours if the lead arrived during business hours, else 10am next business day.
  function firstTouchOverdue(entered, now, r) {
    if (inBusinessHours(entered, r)) return businessHoursBetween(entered, now, r) > r.sc1Hours;
    // Arrived overnight or at the weekend: due at 10am on the next business morning
    // (the same day if it came in before opening on a weekday).
    const due = new Date(entered);
    const weekend = (d) => d.getDay() === 0 || d.getDay() === 6;
    if (due.getHours() >= r.businessEnd || weekend(due)) due.setDate(due.getDate() + 1);
    while (weekend(due)) due.setDate(due.getDate() + 1);
    due.setHours(r.sc1NextDayHour, 0, 0, 0);
    return now > due;
  }

  // ctx: {
  //   deals, spendByMonth (event costs applied), channels, events (Metrics.applyEventCosts),
  //   asOf (ISO), currentMonth, ledgerMonth (latest month with QuickBooks actuals),
  //   rules,
  //   // dashboard checks, for the selected period:
  //   summary, lines, budget, unmatched
  // }
  function evaluate(ctx) {
    const r = Object.assign({}, DEFAULT_RULES, ctx.rules || {});
    const asOf = new Date(ctx.asOf);
    const cur = ctx.currentMonth;
    const week = isoWeek(asOf);
    const idx = M.makeChannelIndex(ctx.channels);
    const channels = idx.channels;
    const marketing = channels.filter((c) => c.leadSources && !c.defaultLeads && !c.excluded);
    const spendCats = channels.filter((c) => !c.excluded && !c.defaultLeads);
    const name = (id) => (idx.byId[id] ? idx.byId[id].name : id);

    const deals = (ctx.deals || []).map((d) => ({ d, ch: idx.attribute(d).id, cm: M.monthOf(d.created), created: new Date(d.created) }));

    // Per channel × lead month: leads, killed, jobs, revenue (cohort) and spend.
    const stat = {};
    const get = (ch, m) => { const c = stat[ch] || (stat[ch] = {}); return c[m] || (c[m] = { leads: 0, killed: 0, jobs: 0, revenue: 0, spend: 0 }); };
    deals.forEach((o) => {
      if (!o.cm) return;
      const s = get(o.ch, o.cm);
      s.leads++;
      if (o.d.killed) s.killed++;
      if (M.isJob(o.d)) { s.jobs++; s.revenue += Number(o.d.amount) || 0; }
    });
    Object.values(ctx.spendByMonth || {}).forEach((rec) => Object.entries(rec.byChannel).forEach(([ch, a]) => { get(ch, rec.month).spend += a; }));
    const qcpl = (s) => (s.spend && s.leads - s.killed > 0 ? s.spend / (s.leads - s.killed) : null);
    const ret = (s) => (s.spend ? s.revenue / s.spend : null);

    const C2 = M.addMonths(cur, -1);
    const C1 = M.addMonths(cur, -2);
    let M2 = C2;
    while (!M.isMatured(M2, asOf)) M2 = M.addMonths(M2, -1);
    const M1 = M.addMonths(M2, -1);

    const register = REGISTER.map((row) => Object.assign({}, row, { status: null, detail: '' }));
    const reg = Object.fromEntries(register.map((row) => [row.id, row]));
    const flags = [];
    // A rule's status is the worst one any channel produced.
    const setStatus = (id, status, detail) => {
      const row = reg[id];
      if (row.status == null || STATUS_ORDER[status] < STATUS_ORDER[row.status]) row.status = status;
      if (detail) row.detail = row.detail ? `${row.detail}; ${detail}` : detail;
    };
    const flag = (rule, f) => {
      const meta = reg[rule] || {};
      flags.push(Object.assign({ rule, owner: meta.owner, cadence: meta.cadence, area: meta.name || f.area }, f));
    };
    const insufficient = {};
    const noteInsufficient = (rule, ch) => { (insufficient[rule] = insufficient[rule] || []).push(name(ch)); };

    // ---- CS-1 / CS-3: return on matured months ----
    marketing.forEach((c) => {
      const a = get(c.id, M1);
      const b = get(c.id, M2);
      if (!a.spend && !b.spend) return; // unpaid channel
      const leads = a.leads + b.leads;
      if (leads < Math.min(r.cs1MinLeads, r.cs3MinLeads)) { noteInsufficient('CS-1', c.id); noteInsufficient('CS-3', c.id); return; }
      const ra = ret(a);
      const rb = ret(b);
      const ev = `${mlabel(M1)}: ${ra == null ? 'no spend' : x(ra)} on ${money(a.spend)}; ${mlabel(M2)}: ${rb == null ? 'no spend' : x(rb)} on ${money(b.spend)}; ${leads} leads. ${REVENUE_CAVEAT}`;
      if (ra != null && rb != null && ra < r.cs1MinReturn && rb < r.cs1MinReturn) {
        setStatus('CS-1', 'breach', name(c.id));
        flag('CS-1', {
          id: `CS-1:${c.id}:${M2}`, severity: 'breach', target: { type: 'channel', id: c.id },
          title: `${c.name}: return under ${r.cs1MinReturn}× for two matured months`,
          detail: ev,
          action: 'Cut this channel’s monthly budget by 25% and move it to the highest-return channel with capacity. Re-measure after two more matured months.',
        });
      }
      const qa = qcpl(a);
      const qb = qcpl(b);
      if (ra != null && rb != null && ra > r.cs3MinReturn && rb > r.cs3MinReturn && (qa == null || qb == null || qb <= qa)) {
        setStatus('CS-3', 'opportunity', name(c.id));
        flag('CS-3', {
          id: `CS-3:${c.id}:${M2}`, severity: 'opportunity', target: { type: 'channel', id: c.id },
          title: `${c.name}: return over ${r.cs3MinReturn}× for two matured months`,
          detail: `${ev} Qualified CPL ${qa == null ? '—' : money(qa)} → ${qb == null ? '—' : money(qb)}.`,
          action: 'Increase budget by 25% and hold for two matured months before increasing again. No more than one scale-up per channel per quarter.',
        });
      }
    });

    // ---- CS-2: qualified CPL breakout ----
    marketing.forEach((c) => {
      const tests = [C1, C2].map((m) => {
        const s = get(c.id, m);
        const hist = [];
        for (let i = 1; i <= r.cs2Months; i++) {
          const q = qcpl(get(c.id, M.addMonths(m, -i)));
          if (q != null) hist.push(q);
        }
        const base = hist.length >= 3 ? hist.reduce((p, v) => p + v, 0) / hist.length : null;
        return { m, s, q: qcpl(s), base };
      });
      if (!tests.some((t) => t.s.spend)) return;
      if (tests.some((t) => t.s.leads < r.cs2MinLeads || t.base == null)) { noteInsufficient('CS-2', c.id); return; }
      if (tests.every((t) => t.q != null && t.q > t.base * r.cs2Ratio)) {
        setStatus('CS-2', 'breach', name(c.id));
        flag('CS-2', {
          id: `CS-2:${c.id}:${C2}`, severity: 'breach', target: { type: 'channel', id: c.id },
          title: `${c.name}: qualified cost per lead up over ${Math.round((r.cs2Ratio - 1) * 100)}% for two months`,
          detail: tests.map((t) => `${mlabel(t.m)}: ${money(t.q)} vs ${money(t.base)} six-month average`).join('; ') + '.',
          action: 'Audit before cutting: check for a bid change, a new competitor, a broken landing page or a tracking break. Budget moves only if the audit finds no fixable cause.',
        });
      }
    });

    // ---- CS-4: untraceable spend ----
    spendCats.forEach((c) => {
      const t = [C1, C2].map((m) => get(c.id, m));
      if (t.every((s) => s.spend > r.cs4MinSpend && s.leads === 0)) {
        setStatus('CS-4', 'breach', name(c.id));
        flag('CS-4', {
          id: `CS-4:${c.id}:${C2}`, severity: 'breach', target: { type: 'channel', id: c.id },
          title: `${c.name}: spend with no attributable leads, two months running`,
          detail: `${mlabel(C1)}: ${money(t[0].spend)}, ${mlabel(C2)}: ${money(t[1].spend)}, and zero leads in either month.`,
          action: 'Instrument it within 30 days (tracked number, unique landing page or coupon code) or remove it from the budget. No third option.',
        });
      }
    });

    // ---- CS-5: event true cost ----
    if (!(ctx.events || []).length) setStatus('CS-5', 'manual', 'No event costs entered (CONFIG.eventCosts)');
    (ctx.events || []).forEach((ev) => {
      if (ev.cost > ev.ledger * r.cs5Ratio) {
        setStatus('CS-5', 'gap', `${ev.name}: ${money(ev.cost)} true vs ${money(ev.ledger)} ledger`);
        flag('CS-5', {
          id: `CS-5:${ev.channel}:${ev.year}`, severity: 'info', target: { type: 'channel', id: ev.channel },
          title: ev.ledger ? `${ev.name}: true cost is ${x(ev.cost / ev.ledger)} the ledger amount` : `${ev.name}: true cost isn’t on the advertising ledger`,
          detail: `${money(ev.cost)} all in vs ${money(ev.ledger)} on the advertising ledger. The dashboard already charges the true cost to the months the event produced leads.`,
          action: 'Keep the true cost in the marketing model (CONFIG.eventCosts) and update it if the final cost changes.',
        });
      }
    });

    // ---- CS-6: concentration (last full quarter) ----
    {
      const qEnd = M.addMonths(`${cur.slice(0, 4)}-${String((Math.floor((+cur.slice(5, 7) - 1) / 3)) * 3 + 1).padStart(2, '0')}`, -1);
      const qMonths = [M.addMonths(qEnd, -2), M.addMonths(qEnd, -1), qEnd];
      const by = marketing.map((c) => ({ c, n: qMonths.reduce((a, m) => a + get(c.id, m).leads, 0) }));
      const total = by.reduce((a, o) => a + o.n, 0);
      const top = by.sort((a, b) => b.n - a.n)[0];
      if (total && top) {
        const share = top.n / total;
        const q = quarterOf(qEnd);
        if (share > r.cs6Share) {
          setStatus('CS-6', 'watch', `${top.c.name} ${pct(share)} in ${q}`);
          flag('CS-6', {
            id: `CS-6:${top.c.id}:${q}`, severity: 'watch', target: { type: 'channel', id: top.c.id },
            title: `${top.c.name} brought ${pct(share)} of marketing leads in ${q}`,
            detail: `${top.n} of ${total} marketing leads. This is a watch rule, not a cut rule.`,
            action: 'No budget change. Write a one-page dependency note: what happens to lead flow if this channel’s cost doubles or its volume halves, and what the fallback is.',
          });
        } else if (share > r.cs6WatchShare) {
          setStatus('CS-6', 'watch', `${top.c.name} at ${pct(share)} in ${q}`);
        } else {
          setStatus('CS-6', 'green', `${top.c.name} at ${pct(share)} in ${q}`);
        }
      }
    }

    // ---- SC-1: speed to first touch ----
    {
      const waiting = deals.filter((o) => o.d.open && o.d.stage === 'New Lead' && o.d.stageEntered && o.ch !== idx.defaultLeads)
        .filter((o) => firstTouchOverdue(new Date(o.d.stageEntered), asOf, r));
      if (waiting.length) {
        setStatus('SC-1', 'breach', `${waiting.length} waiting now`);
        flag('SC-1', {
          id: `SC-1:open:${day(asOf)}`, severity: 'breach',
          title: `${waiting.length} marketing lead${waiting.length === 1 ? '' : 's'} waiting in New Lead past the limit`,
          detail: waiting.slice(0, 6).map((o) => `${o.d.name || 'Deal'} (${name(o.ch)}, waiting ${fmtHours(hours(asOf - new Date(o.d.stageEntered)))})`).join('; ') + (waiting.length > 6 ? `; +${waiting.length - 6} more` : '') + '.',
          action: 'Alert the office manager today: four business hours, or 10am the next business day for overnight leads.',
          deals: waiting.map((o) => o.d.id),
        });
      }
      const w2Start = new Date(asOf - 7 * 864e5);
      const w1Start = new Date(asOf - 14 * 864e5);
      marketing.forEach((c) => {
        const wk = (a, b) => deals.filter((o) => o.ch === c.id && o.created >= a && o.created < b && o.d.firstTouchMs != null).map((o) => hours(o.d.firstTouchMs));
        const w1 = wk(w1Start, w2Start);
        const w2 = wk(w2Start, asOf);
        if (w1.length < r.sc1MinPerWeek || w2.length < r.sc1MinPerWeek) return;
        const m1 = median(w1);
        const m2 = median(w2);
        if (m1 > r.sc1Hours && m2 > r.sc1Hours) {
          setStatus('SC-1', 'breach', `${c.name} weekly median`);
          flag('SC-1', {
            id: `SC-1:${c.id}:${week}`, severity: 'breach', target: { type: 'channel', id: c.id },
            title: `${c.name}: median time to first touch over ${r.sc1Hours} hours two weeks running`,
            detail: `Previous week ${fmtHours(m1)} (${w1.length} leads), last 7 days ${fmtHours(m2)} (${w2.length} leads).`,
            action: 'This is a staffing or routing problem, not a person problem. Escalate to Jon.',
          });
        }
      });
    }

    // ---- SC-2: stage stall ----
    {
      const stalled = deals.filter((o) => o.d.open && r.stallDays[o.d.stage] != null && o.d.stageDays != null && o.d.stageDays > r.stallDays[o.d.stage]);
      if (stalled.length) {
        const byStage = {};
        const byRep = {};
        stalled.forEach((o) => {
          byStage[o.d.stage] = (byStage[o.d.stage] || 0) + 1;
          const rep = o.d.owner || 'Unassigned';
          byRep[rep] = (byRep[rep] || 0) + 1;
        });
        setStatus('SC-2', 'breach', `${stalled.length} open deals`);
        flag('SC-2', {
          id: `SC-2:${week}`, severity: 'breach',
          title: `${stalled.length} open deals have stalled in their stage`,
          detail: `By stage: ${Object.entries(byStage).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}. By rep: ${Object.entries(byRep).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(', ')}.`,
          action: 'Raise each with its rep in the Monday sales meeting, with the stage and day count. Flagged two weeks running and it goes on the rep’s one-to-one agenda.',
          deals: stalled.sort((a, b) => b.d.stageDays - a.d.stageDays).map((o) => o.d.id),
        });
      }
    }

    // ---- SC-3: total cycle drift ----
    {
      const since = new Date(asOf - 90 * 864e5);
      const won = deals.filter((o) => o.d.won && o.d.closed && new Date(o.d.closed) >= since && new Date(o.d.closed) <= asOf);
      const dtc = (o) => (o.d.daysToClose != null ? o.d.daysToClose : (new Date(o.d.closed) - o.created) / 864e5);
      const groups = [
        ['all', 'All won deals', won],
        ['design', 'Design/build path', won.filter((o) => o.d.designPath)],
        ['other', 'Non-design path', won.filter((o) => o.d.designPath === false)],
      ];
      groups.forEach(([key, label, list]) => {
        const base = r.sc3Baseline[key];
        if (list.length < r.sc3MinWon) { if (key === 'all') noteInsufficient('SC-3', label); return; }
        const med = median(list.map(dtc));
        if (med > base * r.sc3Ratio) {
          setStatus('SC-3', 'breach', `${label} ${Math.round(med)} days`);
          flag('SC-3', {
            id: `SC-3:${key}:${cur}`, severity: 'breach',
            title: `${label}: median days to close is ${Math.round(med)} vs ${base}-day baseline`,
            detail: `${list.length} deals won in the last 90 days; ${pct(med / base - 1)} above the 2026 baseline.`,
            action: 'Break it down by stage before acting: Estimating is capacity, Contract Sent is follow-up, Design Phase is designer bandwidth.',
          });
        }
      });
    }

    // ---- LQ-1 to LQ-3: lead quality, rolling 60 days ----
    {
      const since = new Date(asOf - r.lqWindowDays * 864e5);
      marketing.forEach((c) => {
        const list = deals.filter((o) => o.ch === c.id && o.created >= since && o.created <= asOf);
        const n = list.length;
        if (!n) return;
        const share = (fn) => list.filter(fn).length / n;
        const checks = [
          ['LQ-1', r.lq1MinLeads, share((o) => o.d.killed), r.lq1Rate, 'killed at phone',
            'Targeting audit, not a budget cut. Pull the lost reasons, map them to campaign and keyword, and fix the source. Budget moves only under CS-1 or CS-2.'],
          ['LQ-2', r.lqMinLeads, share((o) => o.d.lostReason === 'Out of Service Area'), r.lq2Rate, 'out of service area',
            'Geo-targeting review within two weeks: tighten the radius, add location exclusions, and check whether ad copy is pulling from outside the Upstate.'],
          ['LQ-3', r.lqMinLeads, share((o) => o.d.lostReason === 'Unqualified with Approval'), r.lq3Rate, 'unqualified with approval',
            'Review the keyword and query mix. Separately, check a sample of CallRail recordings to confirm the disqualifications are real and the phone screen isn’t too quick to say no.'],
        ];
        checks.forEach(([rule, floor, rate, limit, what, action]) => {
          if (n < floor) { noteInsufficient(rule, c.id); return; }
          if (rate > limit) {
            setStatus(rule, 'breach', `${c.name} ${pct(rate)}`);
            flag(rule, {
              id: `${rule}:${c.id}:${week}`, severity: 'breach', target: { type: 'channel', id: c.id },
              title: `${c.name}: ${pct(rate)} of leads ${what}`,
              detail: `${Math.round(rate * n)} of ${n} leads in the last ${r.lqWindowDays} days; the limit is ${pct(limit)}.`,
              action,
            });
          }
        });
      });
    }

    // ---- LQ-4: unable to contact, rolling quarter ----
    {
      const since = new Date(asOf - r.lq4WindowDays * 864e5);
      marketing.forEach((c) => {
        const lost = deals.filter((o) => o.ch === c.id && o.d.lost && o.created >= since);
        if (!lost.length) return;
        if (lost.length < r.lq4MinLost) { noteInsufficient('LQ-4', c.id); return; }
        const rate = lost.filter((o) => o.d.lostReason === 'Unable to Contact').length / lost.length;
        if (rate > r.lq4Rate) {
          setStatus('LQ-4', 'breach', `${c.name} ${pct(rate)}`);
          flag('LQ-4', {
            id: `LQ-4:${c.id}:${quarterOf(cur)}`, severity: 'breach', target: { type: 'channel', id: c.id },
            title: `${c.name}: ${pct(rate)} of lost leads were “Unable to Contact”`,
            detail: `${Math.round(rate * lost.length)} of ${lost.length} lost leads over the last quarter.`,
            action: 'Check the follow-up cadence was run before accepting the disposition: three attempts on three different days, one outside 9 to 5, plus a text and an email.',
          });
        }
      });
    }

    // ---- LQ-5: spam (duplicates aren't tracked as a lost reason) ----
    marketing.forEach((c) => {
      const list = deals.filter((o) => o.ch === c.id && o.cm === C2);
      if (!list.length) return;
      if (list.length < r.lq5MinLeads) { noteInsufficient('LQ-5', c.id); return; }
      const rate = list.filter((o) => o.d.lostReason === 'Spam').length / list.length;
      if (rate > r.lq5Rate) {
        setStatus('LQ-5', 'breach', `${c.name} ${pct(rate)}`);
        flag('LQ-5', {
          id: `LQ-5:${c.id}:${C2}`, severity: 'breach', target: { type: 'channel', id: c.id },
          title: `${c.name}: ${pct(rate)} of ${mlabel(C2)} leads were spam`,
          detail: `${Math.round(rate * list.length)} of ${list.length} leads. Duplicates aren’t a lost reason in HubSpot, so only spam is counted.`,
          action: 'Harden the web forms; add a phone-number dedupe rule for CallRail deals.',
        });
      }
    });
    if (!reg['LQ-5'].detail) reg['LQ-5'].detail = 'Spam only: duplicates aren’t tracked';

    // ---- DH-1: lead source population (deals not created by a rep) ----
    {
      const list = deals.filter((o) => o.cm === C2 && o.d.repCreated === false);
      if (!deals.some((o) => o.d.repCreated != null)) setStatus('DH-1', 'not-measured', 'Record source not available');
      else if (list.length < r.dh1MinDeals) noteInsufficient('DH-1', 'deals');
      else {
        const rate = list.filter((o) => o.ch !== idx.defaultLeads).length / list.length;
        if (rate < r.dh1Rate) {
          setStatus('DH-1', 'breach', `${pct(rate)} in ${mlabel(C2)}`);
          flag('DH-1', {
            id: `DH-1:${C2}`, severity: 'breach',
            title: `Known lead source on only ${pct(rate)} of new deals in ${mlabel(C2)}`,
            detail: `${list.length} deals created by forms, calls and integrations (rep-created deals are self-sourced and not counted).`,
            action: 'Make the field required at creation. Until then, the office manager backfills it weekly.',
          });
        } else setStatus('DH-1', 'green', `${pct(rate)} in ${mlabel(C2)}`);
      }
    }

    // ---- DH-5: ledger timeliness ----
    if (ctx.ledgerMonth) {
      const [y, m] = ctx.ledgerMonth.split('-').map(Number);
      const lag = Math.floor((asOf - new Date(y, m, 0)) / 864e5);
      if (lag > r.dh5Days) {
        setStatus('DH-5', 'breach', `${lag} days behind`);
        flag('DH-5', {
          id: `DH-5:${cur}`, severity: 'breach',
          title: `The advertising ledger is ${lag} days behind`,
          detail: `The latest month with QuickBooks actuals is ${mlabel(ctx.ledgerMonth)}. Later months show budget, labelled as estimated.`,
          action: 'Flag to finance and add the missing QuickBooks transaction tabs to the advertising sheet.',
        });
      } else setStatus('DH-5', 'green', `Actuals through ${mlabel(ctx.ledgerMonth)}`);
    }

    NEEDS_ASPIRE.forEach((id) => setStatus(id, 'not-measured', 'Needs Aspire data'));
    setStatus('DH-4', 'manual', 'Pre-launch check');
    Object.entries(insufficient).forEach(([id, list]) => {
      if (reg[id].status == null) reg[id].status = 'insufficient';
      reg[id].detail = `${reg[id].detail ? `${reg[id].detail}; ` : ''}insufficient data: ${[...new Set(list)].join(', ')}`;
    });
    register.forEach((row) => { if (row.status == null) row.status = 'green'; });

    dashboardChecks(ctx, r, flags, cur);
    flags.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return { register, flags };
  }

  // Checks the dashboard adds on top of the standards, for the selected period.
  function dashboardChecks(ctx, r, flags, cur) {
    const s = ctx.summary;
    if (!s) return;
    const add = (f) => flags.push(Object.assign({ rule: 'Dashboard', area: 'Dashboard check', owner: 'Office manager', cadence: 'Monthly' }, f));
    if (s.missingAspire.length >= r.missingAspireMin) {
      const rev = s.missingAspire.reduce((a, d) => a + (Number(d.amount) || 0), 0);
      add({
        id: `DC-aspire:${cur}`, severity: 'watch',
        title: `${s.missingAspire.length} Closed Won deals have no Aspire #`,
        detail: `${money(rev)} of won revenue isn’t counted as jobs, so return is understated.`,
        action: 'Add the Aspire Opportunity # on these deals in HubSpot (listed under Needs attention). Consider making it required at Closed Won.',
      });
    }
    if (ctx.lines) {
      const none = ctx.lines.find((l) => l.id === 'none');
      const all = ctx.lines.reduce((a, l) => a + l.leads, 0);
      if (none && all && none.leads / all >= r.noJobTypeShare) {
        add({
          id: `DC-jobtype:${cur}`, severity: 'watch', target: { type: 'line', id: 'none' },
          title: `${pct(none.leads / all)} of leads have no Type of Job`,
          detail: `${none.leads} leads can’t be split by service line.`,
          action: 'Make “Type of Job” required when a deal is created.',
        });
      }
    }
    const unmatched = (ctx.unmatched || []).reduce((a, l) => a + l.amount, 0);
    if (unmatched >= r.unmatchedSpendMin) {
      const top = {};
      ctx.unmatched.forEach((l) => { top[l.label] = (top[l.label] || 0) + l.amount; });
      add({
        id: `DC-vendors:${cur}`, severity: 'info', owner: 'Marketing manager',
        title: `${money(unmatched)} of spend didn’t match a channel`,
        detail: `Counted as “Other media (untracked)”. Largest: ${Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(', ')}.`,
        action: 'If any of these produce leads, add the vendor to that channel in metrics.js; if not, they are CS-4 candidates.',
      });
    }
    Object.entries(ctx.budget || {}).forEach(([id, b]) => {
      const c = s.channels.find((ch) => ch.id === id);
      if (!c || !b.budget) return;
      if (b.actual > b.budget * r.overBudgetRatio && b.actual - b.budget >= r.overBudgetMin) {
        add({
          id: `DC-budget:${id}:${cur}`, severity: 'watch', owner: 'Jon', target: { type: 'channel', id },
          title: `${c.name}: ${pct(b.actual / b.budget - 1)} over budget`,
          detail: `${money(b.actual)} spent vs ${money(b.budget)} budgeted for the months with actuals.`,
          action: 'Rein spend back in, or update the budget if the overage was planned.',
        });
      }
    });
  }

  return { DEFAULT_RULES, REGISTER, SEVERITY_ORDER, STATUS_ORDER, evaluate, businessHoursBetween, firstTouchOverdue, isoWeek };
});
