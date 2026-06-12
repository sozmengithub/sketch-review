// Pending $99 prototype-shipping detection for the sketch review page.
// The n8n sketch-approval workflow (OnpM6XukzBSPwbvY6Mp-4) auto-adds a
// "Prototype 2-Way Shipping" $99 line item at approval when the deal has
// prototype_method='shipping', deduped by EXACT name match. This must mirror
// that dedupe exactly: strict equality, no trim/case-fold — a near-miss name
// would not stop n8n from adding the charge, so the row must still show.
export const PROTO_SHIPPING_NAME = 'Prototype 2-Way Shipping';
export const PROTO_SHIPPING_PRICE = 99;

export function prototypeShippingPending(prototypeMethod, lineItems) {
  if (prototypeMethod !== 'shipping') return false;
  return !(lineItems || []).some(item => item && item.name === PROTO_SHIPPING_NAME);
}
