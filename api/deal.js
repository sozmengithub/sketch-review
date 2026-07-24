import { detectGrowItems, growEligibility } from './_grow.js';
import { prototypeShippingPending, PROTO_SHIPPING_PRICE } from './_prototype.js';

async function reportError(system, endpoint, error, dealId, dealName) {
  try {
    await fetch('https://showoffinc.app.n8n.cloud/webhook/error-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system, endpoint,
        error: error.message || String(error),
        dealId: dealName ? `${dealName} (${dealId})` : (dealId || 'unknown'),
        timestamp: new Date().toISOString()
      })
    });
  } catch (e) { /* silent */ }
}

// Vercel serverless function to fetch deal + line items from HubSpot
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { dealId } = req.query;

  if (!dealId) {
    return res.status(400).json({ error: 'dealId is required' });
  }

  const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

  if (!HUBSPOT_TOKEN) {
    console.error('HUBSPOT_TOKEN not configured');
    return res.status(500).json({ error: 'HubSpot token not configured' });
  }

  const headers = {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  let dealName = null;
  try {
    // First try to get deal directly by ID
    let deal = null;
    let hubspotDealId = dealId;

    const directResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,amount,designer_notes,sketch_video_url,has_stoning,stoning_budget_low,stoning_budget_high,sketch_options,is_po_customer,sketch_approved,ofcostumes,is_alteration,shipping_street_address__deal_,shipping_street_address_2__deal_,shipping_city,shipping_state,shipping_zip_code,shipping_address_confirmed_date,sketch,sketch_public_url,approved_sketch_link,added_grow_pleat____30_,added_grow_room___10_,hairpieces,has_bra_cups,sport__deal_,costume_components,company_name,prototype_method,lock_sketch_approve`,
      { headers }
    );

    if (directResponse.ok) {
      deal = await directResponse.json();
    } else {
      // If direct lookup fails, search by deal name containing the number
      console.log(`Direct lookup failed for ${dealId}, searching by name...`);

      const searchResponse = await fetch(
        'https://api.hubapi.com/crm/v3/objects/deals/search',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            filterGroups: [{
              filters: [{
                propertyName: 'dealname',
                operator: 'CONTAINS_TOKEN',
                value: dealId
              }]
            }],
            properties: ['dealname', 'amount', 'designer_notes', 'sketch_video_url', 'has_stoning', 'stoning_budget_low', 'stoning_budget_high', 'sketch_options', 'is_po_customer', 'sketch_approved', 'ofcostumes', 'is_alteration', 'shipping_street_address__deal_', 'shipping_street_address_2__deal_', 'shipping_city', 'shipping_state', 'shipping_zip_code', 'shipping_address_confirmed_date', 'sketch', 'sketch_public_url', 'approved_sketch_link', 'added_grow_pleat____30_', 'added_grow_room___10_', 'hairpieces', 'has_bra_cups', 'sport__deal_', 'costume_components', 'company_name', 'prototype_method', 'lock_sketch_approve'],
            limit: 1
          })
        }
      );

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.results && searchData.results.length > 0) {
          deal = searchData.results[0];
          hubspotDealId = deal.id;
        }
      }
    }

    if (!deal) {
      return res.status(404).json({ error: 'Deal not found', dealId });
    }
    dealName = deal.properties.dealname;

    // Check for payer contact on the deal
    let hasPayer = false;
    try {
      const contactAssocResponse = await fetch(
        `https://api.hubapi.com/crm/v4/objects/deals/${hubspotDealId}/associations/contacts`,
        { headers }
      );
      if (contactAssocResponse.ok) {
        const contactAssocData = await contactAssocResponse.json();
        hasPayer = (contactAssocData.results || []).some(r =>
          (r.associationTypes || []).some(a => a.typeId === 102 && a.label === 'Payer')
        );
      }
    } catch (e) { /* non-critical, default to false */ }

    // Get associated line items
    const assocResponse = await fetch(
      `https://api.hubapi.com/crm/v4/objects/deals/${hubspotDealId}/associations/line_items`,
      { headers }
    );

    let lineItems = [];

    if (assocResponse.ok) {
      const assocData = await assocResponse.json();
      const lineItemIds = (assocData.results || []).map(r => r.toObjectId);

      if (lineItemIds.length > 0) {
        // Fetch line item details
        const lineItemsResponse = await fetch(
          'https://api.hubapi.com/crm/v3/objects/line_items/batch/read',
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              inputs: lineItemIds.map(id => ({ id })),
              properties: ['name', 'price', 'quantity', 'amount', 'description', 'hs_product_id']
            })
          }
        );

        if (lineItemsResponse.ok) {
          const lineItemsData = await lineItemsResponse.json();
          lineItems = (lineItemsData.results || []).map(item => ({
            id: item.id,
            name: item.properties.name || 'Item',
            price: parseFloat(item.properties.price) || 0,
            quantity: parseInt(item.properties.quantity) || 1,
            amount: parseFloat(item.properties.amount) || 0,
            description: item.properties.description || '',
            productId: item.properties.hs_product_id || ''
          }));
        }
      }
    }

    // Resolve sketch URL: signed URL from file ID (priority) > approved_sketch_link > sketch_public_url
    let sketchUrl = null;
    const sketchFileId = deal.properties.sketch;
    if (sketchFileId) {
      try {
        const signedRes = await fetch(
          `https://api.hubapi.com/files/v3/files/${sketchFileId}/signed-url`,
          { headers }
        );
        if (signedRes.ok) {
          const signedData = await signedRes.json();
          sketchUrl = signedData.url;
        }
      } catch (e) { /* fall through to other sources */ }
    }
    if (!sketchUrl && deal.properties.approved_sketch_link) {
      sketchUrl = deal.properties.approved_sketch_link;
    }
    if (!sketchUrl && deal.properties.sketch_public_url) {
      sketchUrl = deal.properties.sketch_public_url;
    }

    // Calculate total
    const total = lineItems.reduce((sum, item) => sum + (item.amount || item.price * item.quantity), 0);

    // Grow add-ons (Phase 3 rework): pre-ON state is driven by existing grow
    // LINE ITEMS (created by the measurement form), eligibility by Erica's rules,
    // and we lock the toggle if an invoice already exists (grow changes wouldn't
    // reach an existing invoice). See Measurement_Addons_Grow_Rework_Spec.md.
    const grow = detectGrowItems(lineItems);
    const growElig = growEligibility(
      deal.properties.sport__deal_,
      deal.properties.costume_components,
      deal.properties.company_name
    );

    // Does the deal already have ANY invoice? (lock grow changes if so)
    let hasInvoice = false;
    try {
      const invRes = await fetch(
        `https://api.hubapi.com/crm/v4/objects/deals/${hubspotDealId}/associations/invoices`,
        { headers }
      );
      if (invRes.ok) {
        const invData = await invRes.json();
        hasInvoice = (invData.results || []).length > 0;
      }
    } catch (e) { /* non-critical; default false (do not lock on lookup error) */ }

    return res.status(200).json({
      dealId: deal.id,
      dealName: deal.properties.dealname || 'Your Order',
      amount: parseFloat(deal.properties.amount) || total,
      lineItems: lineItems,
      total: total,
      designerNotes: deal.properties.designer_notes || null,
      sketchVideoUrl: deal.properties.sketch_video_url || null,
      hasPayer: hasPayer,
      hasStoning: deal.properties.has_stoning === 'Yes',
      stoningBudgetLow: parseFloat(deal.properties.stoning_budget_low) || null,
      stoningBudgetHigh: parseFloat(deal.properties.stoning_budget_high) || null,
      isPoCustomer: deal.properties.is_po_customer === 'true',
      // Internal lock: hide the customer Approve button on the review page
      // (already-paid deals whose sketch was reopened/resubmitted). Request
      // Design Change stays available. Set only per-deal by Erica/Scott.
      lockSketchApprove: deal.properties.lock_sketch_approve === 'true',
      isAlteration: deal.properties.is_alteration === 'true',
      sketchApproved: deal.properties.sketch_approved || null,
      ofcostumes: parseInt(deal.properties.ofcostumes) || 1,
      // Grow: pre-ON from existing line items; eligibility from Erica's rules; lock if invoiced
      hasGrowPleatItem: grow.hasGrowPleatItem,
      hasGrowRoomItem: grow.hasGrowRoomItem,
      growPleatAmount: grow.growPleatAmount,
      growRoomAmount: grow.growRoomAmount,
      growPleatEligible: growElig.growPleatEligible,
      growRoomEligible: growElig.growRoomEligible,
      hasInvoice: hasInvoice,
      // Legacy deal-prop flags (kept as fallback; pre-ON is line-item driven now)
      addonGrowPleat: deal.properties.added_grow_pleat____30_ === 'true',
      addonGrowRoom: deal.properties.added_grow_room___10_ === 'true',
      // Prototype: $99 "Prototype 2-Way Shipping" auto-adds at approval (n8n).
      // Pending = method is 'shipping' and the item isn't on the deal yet —
      // the page shows it as a read-only row so the reviewed total matches the invoice.
      prototypeShippingPending: prototypeShippingPending(deal.properties.prototype_method, lineItems),
      prototypeShippingPrice: PROTO_SHIPPING_PRICE,
      // Hairpiece/Bra Cups: pre-fill from intake pick; sketch page charges these (unchanged)
      addonHairpiece: deal.properties.hairpieces === 'Hairpiece',
      addonBraCups: deal.properties.has_bra_cups === 'true',
      shippingAddress: {
        street: deal.properties.shipping_street_address__deal_ || '',
        street2: deal.properties.shipping_street_address_2__deal_ || '',
        city: deal.properties.shipping_city || '',
        state: deal.properties.shipping_state || '',
        zip: deal.properties.shipping_zip_code || ''
      },
      shippingConfirmed: !!deal.properties.shipping_address_confirmed_date,
      sketchUrl: sketchUrl,
      sketchOptions: (() => {
        try {
          const raw = deal.properties.sketch_options;
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
        } catch (e) { return null; }
      })()
    });

  } catch (error) {
    console.error('Error fetching deal:', error.message);
    await reportError('sketch-review', '/api/deal', error, dealId, dealName);
    return res.status(500).json({ error: 'Failed to fetch deal data', details: error.message });
  }
}
