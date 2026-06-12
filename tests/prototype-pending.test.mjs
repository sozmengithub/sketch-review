// Pure-logic tests for the pending $99 prototype-shipping row used by api/deal.js.
// The n8n sketch-approval workflow (OnpM6XukzBSPwbvY6Mp-4) auto-adds a line item
// named EXACTLY "Prototype 2-Way Shipping" at approval when prototype_method='shipping',
// deduped by exact name match. This helper must mirror that dedupe exactly so the
// review page shows the pending row if-and-only-if n8n would add the charge.
// Run: node --test tests/prototype-pending.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prototypeShippingPending, PROTO_SHIPPING_NAME, PROTO_SHIPPING_PRICE } from '../api/_prototype.js';

test('pending: prototype_method=shipping with no line items', () => {
  assert.equal(prototypeShippingPending('shipping', []), true);
});

test('pending: prototype_method=shipping, items exist but none is the $99', () => {
  const items = [
    { name: 'Aspire 3 Bus Costume', amount: 5666.24 },
    { name: 'Shipping (16 costumes + insurance)', amount: 202.99 },
  ];
  assert.equal(prototypeShippingPending('shipping', items), true);
});

test('not pending: $99 line item already on the deal (exact name)', () => {
  const items = [{ name: PROTO_SHIPPING_NAME, amount: 99 }];
  assert.equal(prototypeShippingPending('shipping', items), false);
});

test('exact-name match mirrors n8n dedupe: near-miss names do NOT count as existing', () => {
  // n8n would still add the $99 next to these, so the row must still show
  const items = [
    { name: 'Prototype Shipping', amount: 99 },
    { name: ' Prototype 2-Way Shipping ', amount: 99 },
    { name: 'prototype 2-way shipping', amount: 99 },
  ];
  assert.equal(prototypeShippingPending('shipping', items), true);
});

test('not pending: prototype_method unset/empty/other values', () => {
  assert.equal(prototypeShippingPending(null, []), false);
  assert.equal(prototypeShippingPending(undefined, []), false);
  assert.equal(prototypeShippingPending('', []), false);
  assert.equal(prototypeShippingPending('pickup', []), false);
});

test('pending: lineItems missing/undefined treated as none', () => {
  assert.equal(prototypeShippingPending('shipping', undefined), true);
  assert.equal(prototypeShippingPending('shipping', null), true);
});

test('exports the exact n8n line-item name + price', () => {
  assert.equal(PROTO_SHIPPING_NAME, 'Prototype 2-Way Shipping');
  assert.equal(PROTO_SHIPPING_PRICE, 99);
});
