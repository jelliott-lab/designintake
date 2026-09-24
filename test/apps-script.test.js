const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const installGasMock = require('./gas-mock.js');

function loadCodeGs() {
  const ctx = {};
  const mock = installGasMock(ctx);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/Code.gs'), 'utf8'), ctx);
  return { gs: ctx, mock };
}

test('Code.gs stores calls as sheet rows and round-trips them', () => {
  const { gs, mock } = loadCodeGs();
  assert.deepStrictEqual(JSON.parse(gs.listCalls()), []);

  const created = JSON.parse(gs.createCall(JSON.stringify({ contact: { firstName: 'Pat', lastName: 'Lee', phone: '+1 864-555-0100' } })));
  assert.ok(created.id);
  const sheet = mock.sheets.Calls;
  assert.strictEqual(sheet.rows[0][0], 'ID', 'header row written');
  assert.strictEqual(sheet.rows[1][4], 'Pat Lee');
  assert.strictEqual(sheet.rows[1][5], '+1 864-555-0100', 'phone with leading + is not a formula');

  const saved = JSON.parse(gs.saveCall(created.id, JSON.stringify({ ...created, close: { outcome: 'sold', handoffToRep: true, accountManager: 'Chris' }, aspireEntered: true })));
  assert.strictEqual(saved.createdAt, created.createdAt);
  assert.strictEqual(sheet.rows[1][8], 'Sold');
  assert.strictEqual(sheet.rows[1][9], 'Yes');
  assert.strictEqual(sheet.rows[1][10], 'Chris');
  assert.strictEqual(sheet.rows[1][11], 'Yes');

  const list = JSON.parse(gs.listCalls());
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'Pat Lee');
  assert.strictEqual(list[0].outcome, 'sold');
  assert.strictEqual(JSON.parse(gs.getCall(created.id)).close.accountManager, 'Chris');

  gs.deleteCall(created.id);
  assert.throws(() => gs.getCall(created.id), /not found/);
  assert.strictEqual(sheet.rows.length, 1);
});

test('Code.gs pricing defaults to the built-in placeholder and can be saved', () => {
  const { gs } = loadCodeGs();
  const pricing = JSON.parse(gs.getPricing());
  assert.strictEqual(pricing.placeholder, true);
  assert.ok(pricing.programs.tcplus);
  gs.savePricing(JSON.stringify({ ...pricing, placeholder: false }));
  assert.strictEqual(JSON.parse(gs.getPricing()).placeholder, false);
  assert.throws(() => gs.savePricing('{"x":1}'), /programs/);
});

test('apps-script build output is up to date with /public', () => {
  const html = fs.readFileSync(path.join(__dirname, '../apps-script/Index.html'), 'utf8');
  for (const f of ['styles.css', 'logic.js', 'app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
    assert.ok(html.includes(src.replace(/<\/script/gi, '<\\/script')), `${f} is stale — run npm run build:apps-script`);
  }
});
