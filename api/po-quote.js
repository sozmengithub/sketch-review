async function reportError(system, endpoint, error, dealId) {
  try {
    await fetch('https://showoffinc.app.n8n.cloud/webhook/error-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system, endpoint,
        error: error.message || String(error),
        dealId: dealId || 'unknown',
        timestamp: new Date().toISOString()
      })
    });
  } catch (e) { /* silent */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { dealId } = req.query;
  if (!dealId) return res.status(400).json({ error: 'dealId is required' });

  const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
  if (!HUBSPOT_TOKEN) return res.status(500).json({ error: 'HubSpot token not configured' });

  const headers = {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    // Fetch deal with PO properties
    const dealRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,amount,is_po_customer,po_quote_addressee,po_quote_title,po_quote_notes,po_team_size,sketch_public_url`,
      { headers }
    );
    if (!dealRes.ok) return res.status(404).json({ error: 'Deal not found' });
    const deal = await dealRes.json();

    // Fetch line items
    const assocRes = await fetch(
      `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/line_items`,
      { headers }
    );
    let lineItems = [];
    if (assocRes.ok) {
      const assocData = await assocRes.json();
      const ids = (assocData.results || []).map(r => r.toObjectId);
      if (ids.length > 0) {
        const batchRes = await fetch(
          'https://api.hubapi.com/crm/v3/objects/line_items/batch/read',
          {
            method: 'POST', headers,
            body: JSON.stringify({
              inputs: ids.map(id => ({ id })),
              properties: ['name', 'price', 'quantity', 'amount', 'description']
            })
          }
        );
        if (batchRes.ok) {
          const batchData = await batchRes.json();
          lineItems = (batchData.results || []).map(item => ({
            id: item.id,
            name: item.properties.name || 'Item',
            price: parseFloat(item.properties.price) || 0,
            quantity: parseInt(item.properties.quantity) || 1,
            amount: parseFloat(item.properties.amount) || 0
          }));
        }
      }
    }

    // Fetch existing quote (if any)
    let existingQuote = null;
    const quoteAssocRes = await fetch(
      `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/quotes`,
      { headers }
    );
    if (quoteAssocRes.ok) {
      const quoteAssocData = await quoteAssocRes.json();
      const quoteIds = (quoteAssocData.results || []).map(r => r.toObjectId);
      if (quoteIds.length > 0) {
        const quoteRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/quotes/${quoteIds[0]}?properties=hs_title,hs_status,hs_expiration_date,hs_quote_link`,
          { headers }
        );
        if (quoteRes.ok) {
          const q = await quoteRes.json();
          existingQuote = {
            id: q.id,
            title: q.properties.hs_title,
            status: q.properties.hs_status,
            expirationDate: q.properties.hs_expiration_date,
            quoteLink: q.properties.hs_quote_link
          };
        }
      }
    }

    // Get primary contact
    let primaryContact = null;
    const contactRes = await fetch(
      `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
      { headers }
    );
    if (contactRes.ok) {
      const contactData = await contactRes.json();
      const primaryAssoc = (contactData.results || []).find(r =>
        (r.associationTypes || []).some(a => a.label === 'Primary Contact')
      ) || (contactData.results || [])[0];
      if (primaryAssoc) {
        const cRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${primaryAssoc.toObjectId}?properties=firstname,lastname,email`,
          { headers }
        );
        if (cRes.ok) {
          const c = await cRes.json();
          primaryContact = {
            id: c.id,
            name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' '),
            email: c.properties.email
          };
        }
      }
    }

    const total = lineItems.reduce((sum, item) => sum + (item.amount || item.price * item.quantity), 0);

    return res.status(200).json({
      dealId: deal.id,
      dealName: deal.properties.dealname || '',
      amount: parseFloat(deal.properties.amount) || total,
      total,
      lineItems,
      existingQuote,
      primaryContact,
      sketchUrl: deal.properties.sketch_public_url || null,
      poFields: {
        isPoCustomer: deal.properties.is_po_customer === 'true',
        addressee: deal.properties.po_quote_addressee || '',
        title: deal.properties.po_quote_title || '',
        notes: deal.properties.po_quote_notes || '',
        teamSize: parseInt(deal.properties.po_team_size) || null
      }
    });

  } catch (error) {
    console.error('Error fetching PO quote data:', error.message);
    await reportError('sketch-review', '/api/po-quote', error, dealId);
    return res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
}
