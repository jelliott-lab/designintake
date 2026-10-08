/**
 * Precision Marketing Dashboard — Google Apps Script backend.
 *
 * Create a standalone Apps Script project (script.google.com → New project), paste this file and
 * Index.html into it, add the Script Properties below, then Deploy → New deployment → Web app.
 * See dashboard/README.md for the step-by-step.
 *
 * Script Properties (Project Settings → Script Properties):
 *   HUBSPOT_TOKEN    required  HubSpot private app access token
 *   WINDSOR_API_KEY  optional  Windsor.ai API key, used for ad spend in months with no QuickBooks tab
 *   SPEND_SHEET_ID   optional  overrides CONFIG.spendSheetId
 *
 * Index.html is generated from dashboard/public by `npm run build:dashboard`. Don't edit it by hand.
 * All the math lives in dashboard/public/metrics.js (runs in the browser); this file only fetches.
 */

var CONFIG = {
  // "2026 Advertising Spend by Month" — budget tab plus one QuickBooks transaction tab per month.
  spendSheetId: '1vHCCK16Jtf9quFIDYP-dfxAA2tE92md3oJjM88PYVB8',
  budgetTab: '2026 Budget',
  year: 2026,
  // How far back to pull HubSpot deals and web analytics (start of this year minus N months),
  // so "last 12 months" and period-over-period deltas have data.
  monthsBack: 12,
  cacheMinutes: 30,
  // HubSpot account ID, used to link deals back to HubSpot.
  portalId: 50709738,
  // Leave null to use the defaults in metrics.js (Google Ads, SEO & website, Home & Garden Show,
  // Social media, Direct mail & print, Tools & other, Referral / no source). To change how spend
  // or lead sources roll up into channels, copy Metrics.DEFAULT_CHANNELS here and edit it.
  channels: null,
};

var DEAL_PROPS = [
  'dealname', 'createdate', 'closedate', 'hs_is_closed_won', 'aspire_opportunity',
  'amount_in_home_currency', 'known_lead_source', 'pipeline',
];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Marketing Dashboard · Precision')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Called from the page. Returns a JSON string (google.script.run can't pass Dates reliably).
function getDashboardData(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var hit = readCache_(cache);
    if (hit) return hit;
  }
  var json = JSON.stringify(collect_());
  writeCache_(cache, json);
  return json;
}

function collect_() {
  var props = PropertiesService.getScriptProperties();
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var start = new Date(CONFIG.year, -CONFIG.monthsBack, 1);
  var warnings = [];
  var data = {
    generatedAt: now.toISOString(),
    currentMonth: Utilities.formatDate(now, tz, 'yyyy-MM'),
    year: CONFIG.year,
    budgetTab: CONFIG.budgetTab,
    config: { channels: CONFIG.channels },
    portalId: CONFIG.portalId,
    deals: [],
    pipelines: [],
    web: [],
    windsor: [],
    spendTabs: [],
    warnings: warnings,
  };

  var token = props.getProperty('HUBSPOT_TOKEN');
  if (!token) {
    warnings.push('HubSpot isn’t connected yet: add a HUBSPOT_TOKEN script property (see README).');
  } else {
    tryStep_(warnings, 'HubSpot deals', function () {
      var labels = sourceLabels_(token);
      var pipelines = pipelineLabels_(token);
      data.pipelines = Object.keys(pipelines).map(function (k) { return pipelines[k]; });
      data.deals = fetchDeals_(token, start).map(function (d) {
        var p = d.properties;
        return {
          id: d.id,
          name: p.dealname || '',
          created: (p.createdate || '').slice(0, 10),
          closed: (p.closedate || '').slice(0, 10) || null,
          won: p.hs_is_closed_won === 'true',
          aspire: p.aspire_opportunity || '',
          amount: Number(p.amount_in_home_currency) || 0,
          source: p.known_lead_source || '',
          sourceLabel: labels[p.known_lead_source] || p.known_lead_source || '',
          pipeline: pipelines[p.pipeline] || p.pipeline || '',
        };
      });
    });
    tryStep_(warnings, 'HubSpot website analytics', function () {
      data.web = fetchWebAnalytics_(token, start, now, tz);
    });
  }

  tryStep_(warnings, 'Spend sheet', function () {
    var id = props.getProperty('SPEND_SHEET_ID') || CONFIG.spendSheetId;
    data.spendTabs = SpreadsheetApp.openById(id).getSheets().map(function (sh) {
      return { name: sh.getName(), values: sh.getDataRange().getDisplayValues() };
    });
  });

  var windsorKey = props.getProperty('WINDSOR_API_KEY');
  if (windsorKey) {
    tryStep_(warnings, 'Windsor.ai', function () {
      data.windsor = fetchWindsor_(windsorKey, start, now, tz);
    });
  }
  return data;
}

function tryStep_(warnings, label, fn) {
  try {
    fn();
  } catch (e) {
    warnings.push(label + ' couldn’t be loaded: ' + (e && e.message ? e.message : e));
  }
}

// ---- HubSpot ---------------------------------------------------------------

function hubspot_(token, method, path, body) {
  var res = UrlFetchApp.fetch('https://api.hubapi.com' + path, {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 429) {
    Utilities.sleep(1000);
    return hubspot_(token, method, path, body);
  }
  if (code >= 300) {
    var msg = res.getContentText();
    try { msg = JSON.parse(msg).message || msg; } catch (e) { /* not JSON */ }
    throw new Error('HubSpot ' + code + ': ' + String(msg).slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

// Deals created OR closed since `start`, so close-date revenue includes older leads.
function fetchDeals_(token, start) {
  var since = String(start.getTime());
  var out = [];
  var after;
  do {
    var page = hubspot_(token, 'post', '/crm/v3/objects/deals/search', {
      filterGroups: [
        { filters: [{ propertyName: 'createdate', operator: 'GTE', value: since }] },
        { filters: [{ propertyName: 'closedate', operator: 'GTE', value: since }] },
      ],
      properties: DEAL_PROPS,
      sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }],
      limit: 200,
      after: after,
    });
    out = out.concat(page.results || []);
    after = page.paging && page.paging.next ? page.paging.next.after : null;
    if (after) Utilities.sleep(250); // search API allows ~4 requests/second
  } while (after && out.length < 10000);
  return out;
}

function sourceLabels_(token) {
  var prop = hubspot_(token, 'get', '/crm/v3/properties/deals/known_lead_source');
  var map = {};
  (prop.options || []).forEach(function (o) { map[o.value] = o.label; });
  return map;
}

function pipelineLabels_(token) {
  var res = hubspot_(token, 'get', '/crm/v3/pipelines/deals');
  var map = {};
  (res.results || []).forEach(function (p) { map[p.id] = p.label; });
  return map;
}

var WEB_SOURCE_LABELS = {
  ORGANIC_SEARCH: 'Organic search', PAID_SEARCH: 'Paid search', SOCIAL_MEDIA: 'Organic social',
  PAID_SOCIAL: 'Paid social', REFERRALS: 'Referrals', DIRECT_TRAFFIC: 'Direct traffic',
  EMAIL_MARKETING: 'Email marketing', OTHER_CAMPAIGNS: 'Other campaigns', AI_REFERRALS: 'AI referrals',
  OFFLINE: 'Offline sources',
};

// Traffic-source report from HubSpot's tracking code: sessions and new contacts per source per month.
function fetchWebAnalytics_(token, start, end, tz) {
  var fmt = function (d) { return Utilities.formatDate(d, tz, 'yyyyMMdd'); };
  var res = hubspot_(token, 'get', '/analytics/v2/reports/sources/monthly?start=' + fmt(start) + '&end=' + fmt(end));
  var rows = [];
  Object.keys(res).forEach(function (period) {
    if (!/^\d{4}-\d{2}/.test(period) || !Array.isArray(res[period])) return;
    res[period].forEach(function (r) {
      var key = r.breakdown;
      if (key === 'OFFLINE') return; // imports and manual entries, not website traffic
      rows.push({
        month: period.slice(0, 7),
        source: WEB_SOURCE_LABELS[key] || key,
        visits: Number(r.visits) || 0,
        contacts: Number(r.contacts) || 0,
      });
    });
  });
  return rows;
}

// ---- Windsor.ai (optional) -------------------------------------------------

function fetchWindsor_(key, start, end, tz) {
  var fmt = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var url = 'https://connectors.windsor.ai/all?api_key=' + encodeURIComponent(key) +
    '&date_from=' + fmt(start) + '&date_to=' + fmt(end) +
    '&fields=date,datasource,source,spend,clicks,impressions';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error('Windsor ' + res.getResponseCode());
  var by = {};
  (JSON.parse(res.getContentText()).data || []).forEach(function (r) {
    var src = r.datasource || r.source || 'unknown'; // e.g. google_ads, facebook
    var k = String(r.date).slice(0, 7) + '|' + src;
    var row = by[k] || (by[k] = { month: String(r.date).slice(0, 7), source: src, spend: 0, clicks: 0, impressions: 0 });
    row.spend += Number(r.spend) || 0;
    row.clicks += Number(r.clicks) || 0;
    row.impressions += Number(r.impressions) || 0;
  });
  return Object.keys(by).map(function (k) { return by[k]; });
}

// ---- cache (values are capped at 100KB, so the JSON is stored in chunks) ---

var CHUNK = 90000;

function readCache_(cache) {
  var n = cache.get('dash_n');
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < Number(n); i++) keys.push('dash_' + i);
  var parts = cache.getAll(keys);
  var out = '';
  for (var j = 0; j < keys.length; j++) {
    if (parts[keys[j]] == null) return null;
    out += parts[keys[j]];
  }
  return out;
}

function writeCache_(cache, json) {
  var vals = {};
  var n = Math.ceil(json.length / CHUNK);
  for (var i = 0; i < n; i++) vals['dash_' + i] = json.slice(i * CHUNK, (i + 1) * CHUNK);
  vals.dash_n = String(n);
  try {
    cache.putAll(vals, CONFIG.cacheMinutes * 60);
  } catch (e) {
    // Too big for the cache (100 chunks max): just serve uncached.
  }
}
