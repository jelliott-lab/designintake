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
  // Likewise for service lines (HubSpot "Type of Job" → Design & build, Enhancements, Maintenance
  // & gardening, Lawn & plant care, Irrigation): copy Metrics.DEFAULT_SERVICE_LINES here to change.
  serviceLines: null,
  // Thresholds for the standards triggers (see Flags.DEFAULT_RULES in flags.js), e.g.
  // { cs1MinReturn: 2.5 }. Per the standards doc, log every change in its change log.
  flagRules: null,
  // True all-in cost of events whose ledger amount is amortised or partial (standards CS-5).
  // The channel's ledger spend for that year is replaced by this cost, charged to the months
  // the event produced leads.
  eventCosts: [
    { channel: 'shows', name: 'Home & Garden Show 2026', cost: 30000, year: 2026 },
  ],
  // Stages before a rep sees the lead. A lost deal that never got past these was "killed at
  // phone" (standards definition).
  earlyStages: ['New Lead', 'Call Attempt 1', 'Call Attempt 2'],
};

var DEAL_PROPS = [
  'dealname', 'createdate', 'closedate', 'hs_is_closed_won', 'aspire_opportunity',
  'amount_in_home_currency', 'known_lead_source', 'pipeline', 'hs_analytics_source', 'type_of_job',
  'dealstage', 'hs_is_closed', 'hs_is_closed_lost', 'closed_lost_reason', 'hubspot_owner_id',
  'hs_v2_date_entered_current_stage', 'days_to_close', 'hs_object_source_label',
];
// Stage-history properties (hs_v2_date_entered_<stage>, hs_v2_cumulative_time_in_<stage>) are
// added per pipeline stage at runtime.

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
    config: { channels: CONFIG.channels, serviceLines: CONFIG.serviceLines, flagRules: CONFIG.flagRules, eventCosts: CONFIG.eventCosts },
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
      var pl = pipelinesAndStages_(token);
      var pipelines = pl.pipelines;
      var stages = pl.stages;
      var owners = {};
      tryStep_(warnings, 'HubSpot owners', function () { owners = ownerNames_(token); });
      data.pipelines = Object.keys(pipelines).map(function (k) { return pipelines[k]; });
      var stageIds = Object.keys(stages);
      var extra = [];
      stageIds.forEach(function (id) {
        extra.push('hs_v2_date_entered_' + id);
        if (stages[id].label === 'New Lead') extra.push('hs_v2_cumulative_time_in_' + id);
      });
      var nowMs = now.getTime();
      data.deals = fetchDeals_(token, start, DEAL_PROPS.concat(extra)).map(function (d) {
        var p = d.properties;
        var stage = stages[p.dealstage] || {};
        var lost = p.hs_is_closed_lost === 'true';
        // Killed at phone: lost without ever entering a stage past the early ones.
        var reached = stageIds.some(function (id) {
          var st = stages[id];
          return p['hs_v2_date_entered_' + id] && CONFIG.earlyStages.indexOf(st.label) < 0 && !st.lost;
        });
        var designPath = stageIds.some(function (id) { return stages[id].label === 'Design Phase' && p['hs_v2_date_entered_' + id]; });
        var newLead = stageIds.filter(function (id) { return stages[id].label === 'New Lead' && stages[id].pipelineLabel.indexOf('Official') === 0; })[0];
        var firstTouch = newLead ? Number(p['hs_v2_cumulative_time_in_' + newLead]) : NaN;
        var entered = p.hs_v2_date_entered_current_stage || p['hs_v2_date_entered_' + p.dealstage] || '';
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
          traffic: p.hs_analytics_source || '',
          jobType: p.type_of_job || '',
          stage: stage.label || '',
          open: p.hs_is_closed === 'false',
          lost: lost,
          lostReason: p.closed_lost_reason || '',
          killed: lost && !reached,
          designPath: designPath,
          firstTouchMs: isFinite(firstTouch) && firstTouch >= 0 ? firstTouch : null,
          stageEntered: entered || null,
          stageDays: entered ? (nowMs - new Date(entered).getTime()) / 864e5 : null,
          daysToClose: p.days_to_close !== null && p.days_to_close !== undefined && p.days_to_close !== '' ? Number(p.days_to_close) : null,
          owner: owners[p.hubspot_owner_id] || '',
          // Rep-created deals with no source are self-sourced sales (standards definition).
          repCreated: p.hs_object_source_label ? /^(CRM_UI|MOBILE_)/.test(p.hs_object_source_label) : null,
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

// ---- decisions on review flags ----------------------------------------------
// The standards doc: a tripped trigger produces a recommendation, and Jon (or the rule's owner)
// accepts it or overrides it with a written reason. Decisions are shared by everyone who opens
// the dashboard. Each flag's decision history is its own script property ("review:<flag id>")
// so no single value hits the 9KB property limit.

var REVIEW_PREFIX = 'review:';
var REVIEW_KEEP_DAYS = 400;

function getReviews() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = {};
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(REVIEW_PREFIX) !== 0) return;
    try { out[k.slice(REVIEW_PREFIX.length)] = JSON.parse(all[k]); } catch (e) { /* skip bad entry */ }
  });
  return JSON.stringify(out);
}

// decision: 'accepted', 'overridden' (needs a reason) or 'open' (reopen; history is kept).
function saveReview(flagId, decision, note, title) {
  flagId = String(flagId || '');
  if (!/^[\w:.-]{1,120}$/.test(flagId)) throw new Error('Invalid flag id');
  if (['accepted', 'overridden', 'open'].indexOf(decision) < 0) throw new Error('Invalid decision');
  note = String(note || '').slice(0, 500);
  if (decision === 'overridden' && !note.trim()) throw new Error('An override needs a reason');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var props = PropertiesService.getScriptProperties();
    var key = REVIEW_PREFIX + flagId;
    var rec = {};
    try { rec = JSON.parse(props.getProperty(key) || '{}'); } catch (e) { rec = {}; }
    var entry = {
      decision: decision,
      note: note,
      by: Session.getActiveUser().getEmail() || 'someone at Precision',
      at: new Date().toISOString(),
    };
    rec.title = String(title || rec.title || '').slice(0, 200);
    rec.history = (rec.history || []).concat([entry]).slice(-20);
    rec.decision = decision === 'open' ? null : decision;
    rec.note = decision === 'open' ? '' : note;
    rec.by = entry.by;
    rec.at = entry.at;
    props.setProperty(key, JSON.stringify(rec));
    pruneReviews_(props);
  } finally {
    lock.releaseLock();
  }
  return getReviews();
}

function pruneReviews_(props) {
  var cutoff = Date.now() - REVIEW_KEEP_DAYS * 864e5;
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(REVIEW_PREFIX) !== 0) return;
    try {
      if (new Date(JSON.parse(all[k]).at).getTime() < cutoff) props.deleteProperty(k);
    } catch (e) { /* leave it */ }
  });
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
function fetchDeals_(token, start, properties) {
  var since = String(start.getTime());
  var out = [];
  var after;
  do {
    var page = hubspot_(token, 'post', '/crm/v3/objects/deals/search', {
      filterGroups: [
        { filters: [{ propertyName: 'createdate', operator: 'GTE', value: since }] },
        { filters: [{ propertyName: 'closedate', operator: 'GTE', value: since }] },
        { filters: [{ propertyName: 'hs_is_closed', operator: 'EQ', value: 'false' }] }, // open deals for stall checks
      ],
      properties: properties || DEAL_PROPS,
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

// { pipelines: { id: label }, stages: { stageId: { label, pipelineLabel, lost, won } } }
function pipelinesAndStages_(token) {
  var res = hubspot_(token, 'get', '/crm/v3/pipelines/deals');
  var pipelines = {};
  var stages = {};
  (res.results || []).forEach(function (p) {
    pipelines[p.id] = p.label;
    (p.stages || []).forEach(function (st) {
      var meta = st.metadata || {};
      stages[st.id] = {
        label: st.label,
        pipelineLabel: p.label,
        won: meta.isClosed === 'true' && Number(meta.probability) === 1,
        lost: meta.isClosed === 'true' && Number(meta.probability) === 0,
      };
    });
  });
  return { pipelines: pipelines, stages: stages };
}

function ownerNames_(token) {
  var map = {};
  var after;
  do {
    var res = hubspot_(token, 'get', '/crm/v3/owners?limit=100' + (after ? '&after=' + after : ''));
    (res.results || []).forEach(function (o) {
      map[o.id] = [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id;
    });
    after = res.paging && res.paging.next ? res.paging.next.after : null;
  } while (after);
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
