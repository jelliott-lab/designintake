const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');
const pricing = require('../config/pricing.default.json');

const baseCall = (over = {}) => ({
  createdAt: '2026-09-24T14:00:00Z',
  repName: 'Sam',
  contact: { firstName: 'Pat', lastName: 'Lee', phone: '864-555-0100', street: '1 Main St', city: 'Greenville', state: 'SC', zip: '29601' },
  grass: { season: 'cool' },
  quote: { program: 'tc', frontSqft: '6,000', backSqft: '4000', addOns: [] },
  close: {},
  ...over,
});

test('item price uses the per-visit minimum for small lawns', () => {
  assert.strictEqual(L.itemPrice({ visits: 7, perThousand: 5, minimum: 55 }, 2000), 385);
  assert.strictEqual(L.itemPrice({ visits: 7, perThousand: 5, minimum: 55 }, 20000), 700);
});

test('turf care quote totals square footage from all areas', () => {
  const q = L.calcQuote(baseCall(), pricing);
  assert.strictEqual(q.sqft, 10000);
  assert.strictEqual(q.lines.length, 1);
  assert.strictEqual(q.total, 7 * 55);
});

test('turf care+ includes season-appropriate aeration unless removed', () => {
  const cool = L.calcQuote(baseCall({ quote: { program: 'tcplus', frontSqft: 10000, addOns: ['aeration_overseed'] } }), pricing);
  assert.ok(cool.lines[1].label.startsWith('Aeration & Overseeding'));
  assert.strictEqual(cool.lines.length, 2, 'included aeration is not double-charged as an add-on');

  const warm = L.calcQuote(baseCall({ grass: { season: 'warm' }, quote: { program: 'tcplus', frontSqft: 10000 } }), pricing);
  assert.ok(warm.lines[1].label.startsWith('Aeration (warm'));

  const removed = L.calcQuote(baseCall({ quote: { program: 'tcplus', frontSqft: 10000, removeAeration: true } }), pricing);
  assert.strictEqual(removed.lines.length, 1);
});

test('price override replaces calculated total', () => {
  const q = L.calcQuote(baseCall({ quote: { program: 'tc', frontSqft: 5000, priceOverride: '$400' } }), pricing);
  assert.strictEqual(q.total, 400);
  assert.ok(q.overridden);
});

test('recommendation follows the sales doc', () => {
  assert.strictEqual(L.recommendedProgram({ season: 'cool' }).program, 'tcplus');
  assert.strictEqual(L.recommendedProgram({ season: 'warm', warmType: 'zoysia' }).program, 'tcplus');
  assert.strictEqual(L.recommendedProgram({ season: 'warm', warmType: 'bermuda' }).program, 'tc');
  assert.strictEqual(L.recommendedProgram({ season: 'unknown' }), null);
});

test('summary includes contact, quote, handoff and notes', () => {
  const s = L.buildSummary(baseCall({
    close: { outcome: 'site_visit', handoffToRep: true, accountManager: 'Chris' },
    grass: { season: 'unknown' },
    notes: 'Gate code 1234',
  }), pricing);
  assert.match(s, /Name: Pat Lee/);
  assert.match(s, /Address: 1 Main St, Greenville, SC 29601/);
  assert.match(s, /Turf area: 10,000 sq ft \(front 6,000 \/ back 4,000\)/);
  assert.match(s, /Account manager to confirm turf type on site/);
  assert.match(s, /Sent to account manager: Yes — Chris/);
  assert.match(s, /PLACEHOLDER/);
  assert.match(s, /Gate code 1234/);
});
