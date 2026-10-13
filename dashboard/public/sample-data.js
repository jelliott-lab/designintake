// Made-up demo data so the page can be previewed without HubSpot (open index.html in a browser).
// The Apps Script build drops this file; the live dashboard always uses real data.
(function (root) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (weights) => {
    let r = rand() * weights.reduce((a, w) => a + w[1], 0);
    return weights.find((w) => (r -= w[1]) < 0)[0];
  };
  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const pad = (n) => String(n).padStart(2, '0');
  const sources = [['google_ads', 30], ['organic', 18], ['WordPress Site', 6], ['Home & Garden Show', 5], ['social_media', 2], ['direct_mail', 1], ['', 38]];
  const season = [0.35, 0.8, 1.6, 1.4, 1.2, 1.1, 1.05, 0.9, 0.85, 0.7, 0.45, 0.3];

  const deals = [];
  let id = 1;
  for (let y = year - 1; y <= year; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${pad(m)}`;
      if (key > currentMonth) break;
      const n = Math.round(110 * season[m - 1] * (key === currentMonth ? now.getDate() / 30 : 1));
      for (let i = 0; i < n; i++) {
        let source = pick(sources);
        if (source === 'Home & Garden Show' && !(m === 2 || m === 3)) source = '';
        const created = `${key}-${pad(1 + Math.floor(rand() * 28))}`;
        const won = rand() < (source === '' ? 0.22 : source === 'Home & Garden Show' ? 0.18 : 0.1);
        const lag = Math.floor(rand() * 3);
        const cm = new Date(y, m - 1 + lag, 1 + Math.floor(rand() * 27));
        const closedStr = `${cm.getFullYear()}-${pad(cm.getMonth() + 1)}-${pad(cm.getDate())}`;
        const jobType = pick([['Landscape Design & Install', 32], ['Maintenance & Gardening', 17], ['Enhancement', 16], ['Lawn Care', 14], ['Plant Health Care', 2], ['Irrigation Services', 5], ['Exterior Pest Control', 2], ['', 12]]);
        const big = jobType === 'Landscape Design & Install' && rand() < 0.4;
        const isWon = won && closedStr <= `${currentMonth}-28`;
        const ageDays = (now - new Date(created)) / 864e5;
        const open = !isWon && ageDays < 75 && rand() < 0.35;
        const lost = !isWon && !open;
        const killed = lost && rand() < (source === 'google_ads' ? 0.62 : source === 'Home & Garden Show' ? 0.15 : 0.4);
        const stage = open ? pick([['New Lead', 6], ['Appointment Scheduled', 30], ['Design Phase', 10], ['Estimating', 20], ['Contract Sent', 25], ['Revisions', 4]]) : isWon ? 'Closed Won' : 'Closed Lost';
        const stageDays = open ? (stage === 'New Lead' ? rand() * 0.6 : Math.min(ageDays, rand() * 30)) : null;
        deals.push({
          id: `sample-${id++}`,
          name: `Sample project ${id}`,
          created,
          closed: won && closedStr <= `${currentMonth}-28` ? closedStr : null,
          won: isWon,
          aspire: rand() < 0.88 ? String(20000 + id) : '',
          amount: Math.round(big ? 40000 + rand() * 120000 : 2500 + rand() * 18000),
          source,
          sourceLabel: '',
          pipeline: jobType === 'Lawn Care' && rand() < 0.5 ? 'Lawn Care Pipeline' : 'Official Sales Pipeline',
          traffic: source ? '' : pick([['OFFLINE', 75], ['DIRECT_TRAFFIC', 10], ['', 10], ['PAID_SEARCH', 3], ['ORGANIC_SEARCH', 2]]),
          jobType,
          stage,
          open,
          lost,
          killed,
          lostReason: !lost ? '' : killed ? pick([['Unqualified with Approval', 55], ['Out of Service Area', 15], ['Spam', 8], ['Unable to Contact', 22]]) : pick([['Price', 35], ['Went with Competitor', 20], ['Unable to Contact', 15], ['Changed Mind', 15], ['Bad Timing', 15]]),
          designPath: isWon ? jobType === 'Landscape Design & Install' : false,
          firstTouchMs: source ? (source === 'google_ads' ? 0.5 + rand() * 3 : 2 + rand() * 30) * 36e5 : 5 * 6e4,
          stageEntered: open ? new Date(now - stageDays * 864e5).toISOString() : null,
          stageDays,
          daysToClose: isWon ? Math.round((new Date(closedStr) - new Date(created)) / 864e5) : null,
          owner: pick([['Sample rep A', 1], ['Sample rep B', 1], ['Sample rep C', 1]]),
          repCreated: !source,
        });
      }
    }
  }

  // Budget tab in the same layout as the real "2026 Budget" sheet; actuals only for past months.
  const months = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const items = [
    ['Landscape Leadership', 7833, 7833], ['Hubspot', 1611, 1765], ['Call Rail', 58, 90],
    ['Google PPC Ads', 4000, 5200], ['Google Local Service Ads', 0, 850], ['HBA Invoice Payoff', 2167, 2410],
    ['Misc', 1000, 1500], ['Print Materials', 0, 300], ['Social Media Boosts', 0, 250],
  ];
  const lastActual = Math.max(0, now.getMonth() - 2); // leave the last two months "not entered yet"
  const head1 = [''];
  const head2 = ['Item'];
  months.forEach((mo) => { head1.push(mo, ''); head2.push('Budget', 'Actual'); });
  const fmt = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows = items.map(([name, budget, actual]) => {
    const r = [name];
    months.forEach((_, i) => {
      const seasonal = name.startsWith('Google PPC') ? season[i] * 1.4 : 1;
      r.push(fmt(budget * seasonal), i < lastActual ? fmt(Math.round(actual * seasonal * (0.85 + rand() * 0.3))) : '');
    });
    return r;
  });
  rows.push(['Total:']);

  const web = [];
  const webSources = [['Organic search', 900, 0.03], ['Paid search', 650, 0.06], ['Direct traffic', 520, 0.04], ['Referrals', 120, 0.03], ['Organic social', 90, 0.01], ['AI referrals', 30, 0.05]];
  for (let y = year - 1; y <= year; y++) {
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${pad(m)}`;
      if (key > currentMonth) break;
      webSources.forEach(([source, base, conv]) => {
        const visits = Math.round(base * season[m - 1] * (0.85 + rand() * 0.3));
        web.push({ month: key, source, visits, contacts: Math.round(visits * conv) });
      });
    }
  }

  root.SAMPLE_DATA = {
    sample: true,
    generatedAt: now.toISOString(),
    currentMonth,
    year,
    budgetTab: `${year} Budget`,
    config: { channels: null, eventCosts: [{ channel: 'shows', name: `Home & Garden Show ${year}`, cost: 30000, year }] },
    portalId: null,
    deals,
    pipelines: ['Official Sales Pipeline', 'Lawn Care Pipeline'],
    web,
    windsor: [],
    spendTabs: [{ name: `${year} Budget`, values: [head1, head2, ...rows] }],
    warnings: ['Showing made-up sample data. Open the Apps Script web app to see real numbers.'],
  };
})(typeof self !== 'undefined' ? self : this);
