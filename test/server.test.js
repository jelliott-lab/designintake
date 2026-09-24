const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-'));
const { createServer } = require('../server.js');

test('calls can be created, updated, listed and deleted', async (t) => {
  const server = createServer().listen(0);
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (method, url, body) =>
    fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const created = await (await json('POST', '/api/calls', { contact: { firstName: 'Pat' } })).json();
  assert.ok(created.id);

  const updated = await (await json('PUT', `/api/calls/${created.id}`, { ...created, close: { outcome: 'sold', handoffToRep: true } })).json();
  assert.strictEqual(updated.createdAt, created.createdAt);

  const list = await (await json('GET', '/api/calls')).json();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'Pat');
  assert.strictEqual(list[0].outcome, 'sold');
  assert.strictEqual(list[0].handoffToRep, true);

  assert.strictEqual((await json('DELETE', `/api/calls/${created.id}`)).status, 204);
  assert.strictEqual((await json('GET', `/api/calls/${created.id}`)).status, 404);

  const pricing = await (await json('GET', '/api/pricing')).json();
  assert.ok(pricing.programs.tc);
  assert.strictEqual((await json('PUT', '/api/pricing', { nope: 1 })).status, 400);

  assert.strictEqual((await fetch(base + '/../server.js')).status !== 200, true);
  assert.strictEqual((await fetch(base + '/')).status, 200);
});
