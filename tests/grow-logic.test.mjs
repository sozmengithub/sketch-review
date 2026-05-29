// Pure-logic tests for the grow add-on detection + eligibility used by api/deal.js.
// Run: node --test tests/grow-logic.test.mjs   (no framework needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectGrowItems, growEligibility, PLEAT_PID, ROOM_PID } from '../api/_grow.js';

test('detectGrowItems: finds grow line items by product id + amounts', () => {
  const items = [
    { productId: '', name: 'Custom Costume', amount: 300, price: 100, quantity: 3 },
    { productId: PLEAT_PID, name: 'Grow Pleat', amount: 90, price: 30, quantity: 3 },
  ];
  const r = detectGrowItems(items);
  assert.equal(r.hasGrowPleatItem, true);
  assert.equal(r.hasGrowRoomItem, false);
  assert.equal(r.growPleatAmount, 90);
  assert.equal(r.growRoomAmount, 0);
});

test('detectGrowItems: both present; amount falls back to price*qty', () => {
  const items = [
    { productId: PLEAT_PID, name: 'Grow Pleat', amount: 0, price: 30, quantity: 4 },
    { productId: ROOM_PID, name: 'Grow Room', amount: 40, price: 10, quantity: 4 },
  ];
  const r = detectGrowItems(items);
  assert.equal(r.hasGrowPleatItem, true);
  assert.equal(r.hasGrowRoomItem, true);
  assert.equal(r.growPleatAmount, 120); // 30*4 fallback when amount is 0
  assert.equal(r.growRoomAmount, 40);
});

test('detectGrowItems: a generic (no product id) "Grow Pleat" is NOT detected', () => {
  // legacy/double-bill-risk items have no product id -> must be invisible to product-id detection
  const items = [{ productId: '', name: 'Grow Pleat', amount: 30, price: 30, quantity: 1 }];
  const r = detectGrowItems(items);
  assert.equal(r.hasGrowPleatItem, false);
});

test('detectGrowItems: empty/no items', () => {
  const r = detectGrowItems([]);
  assert.deepEqual(r, { hasGrowPleatItem: false, hasGrowRoomItem: false, growPleatAmount: 0, growRoomAmount: 0 });
});

test('growEligibility: eligible sport + skirt -> both eligible', () => {
  const r = growEligibility('Twirling', 'two_piece;short_skirt', 'ACME Twirl');
  assert.equal(r.growPleatEligible, true);
  assert.equal(r.growRoomEligible, true);
});

test('growEligibility: eligible sport + pants -> room only (no pleat)', () => {
  const r = growEligibility('Color Guard', 'one_piece;pants', 'ACME');
  assert.equal(r.growPleatEligible, false);
  assert.equal(r.growRoomEligible, true);
});

test('growEligibility: long skirt counts for pleat', () => {
  assert.equal(growEligibility('Cheerleading', 'two_piece;skirt', 'X').growPleatEligible, true);
});

test('growEligibility: ineligible sport -> neither', () => {
  const r = growEligibility('Dancing', 'two_piece;short_skirt', 'X');
  assert.equal(r.growPleatEligible, false);
  assert.equal(r.growRoomEligible, false);
});

test('growEligibility: Impact Dance excluded (variants)', () => {
  for (const c of ['Impact Dance', 'Impact  Dance', '  IMPACT DANCE ', 'Impact Dance LLC']) {
    const r = growEligibility('Twirling', 'two_piece;short_skirt', c);
    assert.equal(r.growPleatEligible, false, c);
    assert.equal(r.growRoomEligible, false, c);
  }
  // legit company still eligible
  assert.equal(growEligibility('Twirling', 'two_piece;short_skirt', 'Impactful Dancers').growRoomEligible, true);
});

test('growEligibility: missing/blank inputs -> not eligible, no throw', () => {
  const r = growEligibility('', '', '');
  assert.equal(r.growPleatEligible, false);
  assert.equal(r.growRoomEligible, false);
});
