// Pure helpers for grow add-on detection + eligibility on the sketch page.
// Source of truth for the sketch path; mirrors the intake form's rules in
// intake-form/public/custom-addons.js (keep the two in sync — see
// ~/.claude/docs/Measurement_Addons_Grow_Rework_Spec.md).

export const PLEAT_PID = '21854296417'; // HubSpot product id — Grow Pleat ($30)
export const ROOM_PID = '21854296420';  // HubSpot product id — Grow Room ($10)

const GROW_SPORTS = ['Twirling', 'Color Guard', 'Cheerleading'];
const EXCLUDED_COMPANY = 'impact dance';
const SKIRT_BOTTOMS = ['short_skirt', 'skirt']; // 'skirt' = Long Skirt

// Detect existing grow line items by product id (NOT by name — a generic,
// no-product-id "Grow Pleat" must stay invisible so it can't be double-counted).
export function detectGrowItems(lineItems) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const amt = (li) => (li.amount || (Number(li.price) || 0) * (Number(li.quantity) || 0)) || 0;
  const pleat = items.find(li => li.productId === PLEAT_PID);
  const room = items.find(li => li.productId === ROOM_PID);
  return {
    hasGrowPleatItem: !!pleat,
    hasGrowRoomItem: !!room,
    growPleatAmount: pleat ? amt(pleat) : 0,
    growRoomAmount: room ? amt(room) : 0,
  };
}

// Erica's eligibility rules for showing the grow ADD option on the sketch page.
export function growEligibility(sport, costumeComponents, companyName) {
  const company = String(companyName || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const excluded = company.includes(EXCLUDED_COMPANY);
  const sportOk = GROW_SPORTS.includes(String(sport || ''));
  const bottoms = String(costumeComponents || '').split(';').map(s => s.trim());
  const hasSkirt = bottoms.some(b => SKIRT_BOTTOMS.includes(b));
  const growRoomEligible = sportOk && !excluded;
  const growPleatEligible = growRoomEligible && hasSkirt;
  return { growPleatEligible, growRoomEligible };
}
