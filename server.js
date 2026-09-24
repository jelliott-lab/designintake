// Turf Care Call Guide — small zero-dependency server.
// Serves the web app from /public and stores calls + pricing as JSON files in DATA_DIR
// so every rep's calls are shared in one place.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_PRICING = path.join(__dirname, 'config', 'pricing.default.json');
// Optional shared passcode. When set, browsers are prompted for it (any username).
const APP_PASSCODE = process.env.APP_PASSCODE || '';

const CALLS_FILE = path.join(DATA_DIR, 'calls.json');
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json');
const MAX_BODY = 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---- storage ---------------------------------------------------------------

let writeChain = Promise.resolve();

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Writes are serialized and atomic (temp file + rename) so concurrent saves can't corrupt data.
function writeJson(file, value) {
  const run = async () => {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
    await fsp.rename(tmp, file);
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

async function loadCalls() {
  return readJson(CALLS_FILE, []);
}

async function loadPricing() {
  const saved = await readJson(PRICING_FILE, null);
  if (saved) return saved;
  return JSON.parse(await fsp.readFile(DEFAULT_PRICING, 'utf8'));
}

// ---- http helpers ----------------------------------------------------------

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? MIME['.json'] : headers['Content-Type'] || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function authorized(req) {
  if (!APP_PASSCODE) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const pass = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(APP_PASSCODE);
  return pass.length === expected.length && crypto.timingSafeEqual(pass, expected);
}

// Only the fields the list screen needs.
function listItem(c) {
  const contact = c.contact || {};
  return {
    id: c.id,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    repName: c.repName || '',
    name: [contact.firstName, contact.lastName].filter(Boolean).join(' '),
    phone: contact.phone || '',
    address: [contact.street, contact.city].filter(Boolean).join(', '),
    outcome: (c.close && c.close.outcome) || '',
    handoffToRep: !!(c.close && c.close.handoffToRep),
    aspireEntered: !!c.aspireEntered,
  };
}

// ---- api -------------------------------------------------------------------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'calls', id?]
  const [, resource, id] = parts;

  if (resource === 'calls') {
    const calls = await loadCalls();

    if (!id && req.method === 'GET') {
      const items = calls.map(listItem).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return send(res, 200, items);
    }

    if (!id && req.method === 'POST') {
      const body = await readBody(req);
      const now = new Date().toISOString();
      const call = { ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      calls.push(call);
      await writeJson(CALLS_FILE, calls);
      return send(res, 201, call);
    }

    const idx = calls.findIndex((c) => c.id === id);
    if (idx === -1) return send(res, 404, { error: 'Call not found' });

    if (req.method === 'GET') return send(res, 200, calls[idx]);

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const updated = { ...body, id, createdAt: calls[idx].createdAt, updatedAt: new Date().toISOString() };
      calls[idx] = updated;
      await writeJson(CALLS_FILE, calls);
      return send(res, 200, updated);
    }

    if (req.method === 'DELETE') {
      calls.splice(idx, 1);
      await writeJson(CALLS_FILE, calls);
      return send(res, 204, '');
    }
  }

  if (resource === 'pricing' && !id) {
    if (req.method === 'GET') return send(res, 200, await loadPricing());
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || !body.programs || !Array.isArray(body.addOns)) {
        return send(res, 400, { error: 'Pricing must include programs and addOns' });
      }
      await writeJson(PRICING_FILE, body);
      return send(res, 200, body);
    }
  }

  return send(res, 404, { error: 'Not found' });
}

// ---- static ----------------------------------------------------------------

async function serveStatic(res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  try {
    const data = await fsp.readFile(file);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---- server ----------------------------------------------------------------

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (!authorized(req)) {
        return send(res, 401, 'Passcode required', { 'WWW-Authenticate': 'Basic realm="Turf Care Call Guide"' });
      }
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return await serveStatic(res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
    }
  });
}

if (require.main === module) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  createServer().listen(PORT, () => {
    console.log(`Turf Care Call Guide running at http://localhost:${PORT}`);
    console.log(`Data directory: ${DATA_DIR}${APP_PASSCODE ? ' (passcode enabled)' : ''}`);
  });
}

module.exports = { createServer };
