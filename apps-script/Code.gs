/**
 * Turf Care Call Guide — Google Apps Script backend.
 *
 * Paste this file and Index.html into the Apps Script editor of a Google Sheet
 * (Extensions → Apps Script), then Deploy → New deployment → Web app.
 * Each call is saved as one row on the "Calls" tab of that Sheet.
 *
 * Index.html is generated from /public by `npm run build:apps-script` (which also fills in
 * DEFAULT_PRICING below from config/pricing.default.json). Don't edit Index.html by hand.
 */

var CALLS_SHEET = 'Calls';
var HEADERS = [
  'ID', 'Created', 'Updated', 'Rep', 'Customer', 'Phone', 'Email', 'Address',
  'Outcome', 'Sent to account manager', 'Account manager', 'Entered in Aspire', 'Call data (do not edit)',
];
var DATA_COL = HEADERS.length;

// @@DEFAULT_PRICING_START
var DEFAULT_PRICING = {
  "placeholder": true,
  "note": "PLACEHOLDER PRICES. Replace these with the real numbers from the Aspire kits on the Pricing page before quoting customers.",
  "programs": {
    "tc": {
      "name": "Precision Turf Care",
      "visits": 7,
      "perThousand": 5,
      "minimum": 55
    },
    "tcplus": {
      "name": "Precision Turf Care+",
      "visits": 11,
      "perThousand": 5.5,
      "minimum": 60
    }
  },
  "addOns": [
    {
      "id": "aeration",
      "name": "Aeration (warm season)",
      "visits": 1,
      "perThousand": 15,
      "minimum": 150
    },
    {
      "id": "aeration_overseed",
      "name": "Aeration & Overseeding (cool season)",
      "visits": 1,
      "perThousand": 30,
      "minimum": 250
    },
    {
      "id": "top_dressing",
      "name": "Top dressing (sand for warm season / topsoil for fescue)",
      "visits": 1,
      "perThousand": 40,
      "minimum": 300
    },
    {
      "id": "soil_amendment",
      "name": "Soil amendment program (soil sample + treatment)",
      "visits": 1,
      "perThousand": 10,
      "minimum": 125
    },
    {
      "id": "mosquito",
      "name": "Mosquito control",
      "visits": 7,
      "perThousand": 0,
      "minimum": 65
    },
    {
      "id": "flea_tick",
      "name": "Flea & tick control",
      "visits": 4,
      "perThousand": 3,
      "minimum": 55
    },
    {
      "id": "perimeter_pest",
      "name": "Perimeter pest control",
      "visits": 4,
      "perThousand": 0,
      "minimum": 65
    },
    {
      "id": "fire_ant",
      "name": "Fire ant control",
      "visits": 1,
      "perThousand": 4,
      "minimum": 95
    },
    {
      "id": "grub",
      "name": "Grub control",
      "visits": 1,
      "perThousand": 4,
      "minimum": 85
    },
    {
      "id": "army_worm",
      "name": "Army worm control",
      "visits": 1,
      "perThousand": 3,
      "minimum": 75
    }
  ]
};
// @@DEFAULT_PRICING_END

var OUTCOMES = {
  sold: 'Sold',
  quote_emailed: 'Quote emailed',
  site_visit: 'Site visit',
  not_interested: 'Not interested',
  research: 'Research only',
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Turf Care Call Guide')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---- sheet helpers ---------------------------------------------------------

function callsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CALLS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CALLS_SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Plain text everywhere so phone numbers and ZIPs are kept exactly as typed.
    sh.getRange(1, 1, sh.getMaxRows(), HEADERS.length).setNumberFormat('@');
  }
  return sh;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Row number (1-based) of a call, or -1.
function findRow_(sh, id) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

// Keep customer-typed text from being treated as a spreadsheet formula.
function cell_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function fmtTime_(iso) {
  if (!iso) return '';
  return Utilities.formatDate(new Date(iso), Session.getScriptTimeZone(), 'yyyy-MM-dd h:mm a');
}

function toRow_(call) {
  var c = call.contact || {};
  var cl = call.close || {};
  var cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [
    call.id,
    fmtTime_(call.createdAt),
    fmtTime_(call.updatedAt),
    cell_(call.repName),
    cell_([c.firstName, c.lastName].filter(Boolean).join(' ')),
    cell_(c.phone),
    cell_(c.email),
    cell_([c.street, cityLine].filter(Boolean).join(', ')),
    OUTCOMES[cl.outcome] || 'In progress',
    cl.handoffToRep ? 'Yes' : '',
    cell_(cl.accountManager),
    call.aspireEntered ? 'Yes' : '',
    JSON.stringify(call),
  ];
}

function listItem_(c) {
  var contact = c.contact || {};
  var close = c.close || {};
  return {
    id: c.id,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    repName: c.repName || '',
    name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    phone: contact.phone || '',
    address: [contact.street, contact.city].filter(Boolean).join(', '),
    outcome: close.outcome || '',
    handoffToRep: !!close.handoffToRep,
    aspireEntered: !!c.aspireEntered,
  };
}

function parseBody_(json) {
  var body = typeof json === 'string' ? JSON.parse(json) : json;
  if (!body || typeof body !== 'object') throw new Error('Invalid data');
  return body;
}

// ---- functions called from the web page (google.script.run) ---------------

function listCalls() {
  var sh = callsSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return '[]';
  var rows = sh.getRange(2, DATA_COL, n, 1).getValues();
  var items = [];
  rows.forEach(function (r) {
    try {
      items.push(listItem_(JSON.parse(r[0])));
    } catch (e) { /* skip rows that were hand-edited into invalid JSON */ }
  });
  items.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
  return JSON.stringify(items);
}

function getCall(id) {
  var sh = callsSheet_();
  var row = findRow_(sh, id);
  if (row === -1) throw new Error('Call not found');
  return sh.getRange(row, DATA_COL).getValue();
}

function createCall(json) {
  var body = parseBody_(json);
  return withLock_(function () {
    var now = new Date().toISOString();
    body.id = Utilities.getUuid();
    body.createdAt = now;
    body.updatedAt = now;
    var sh = callsSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, 1, HEADERS.length).setValues([toRow_(body)]);
    return JSON.stringify(body);
  });
}

function saveCall(id, json) {
  var body = parseBody_(json);
  return withLock_(function () {
    var sh = callsSheet_();
    var row = findRow_(sh, id);
    if (row === -1) throw new Error('Call not found');
    var existing = JSON.parse(sh.getRange(row, DATA_COL).getValue());
    body.id = id;
    body.createdAt = existing.createdAt;
    body.updatedAt = new Date().toISOString();
    sh.getRange(row, 1, 1, HEADERS.length).setValues([toRow_(body)]);
    return JSON.stringify(body);
  });
}

function deleteCall(id) {
  return withLock_(function () {
    var sh = callsSheet_();
    var row = findRow_(sh, id);
    if (row !== -1) sh.deleteRow(row);
    return null;
  });
}

function getPricing() {
  var saved = PropertiesService.getScriptProperties().getProperty('pricing');
  return saved || JSON.stringify(DEFAULT_PRICING);
}

function savePricing(json) {
  var body = parseBody_(json);
  if (!body.programs || !Array.isArray(body.addOns)) throw new Error('Pricing must include programs and addOns');
  var text = JSON.stringify(body);
  PropertiesService.getScriptProperties().setProperty('pricing', text);
  return text;
}
