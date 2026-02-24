import crypto from 'crypto';

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

function validateToken(dealId, token) {
  const secret = process.env.PO_QUOTE_SECRET;
  if (!secret || !token) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(String(dealId))
    .digest('hex')
    .substring(0, 16);
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(String(token).substring(0, 16).padEnd(16, '0'), 'utf8')
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { dealId, token } = req.query;
  if (!dealId) return res.status(400).json({ error: 'dealId is required' });
  if (!token) return res.status(403).json({ error: 'Access denied' });

  if (!validateToken(dealId, token)) {
    return res.status(403).json({ error: 'Invalid or expired link' });
  }

  const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
  if (!HUBSPOT_TOKEN) return res.status(500).json({ error: 'HubSpot token not configured' });

  const headers = {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    // Fetch deal with PO properties
    const dealRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,amount,po_quote_addressee,po_quote_title,po_quote_notes,po_quote_verbiage,po_quote_status,po_quote_link,po_document_url,po_received_date`,
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

    // Get contacts — find payer (preferred) and primary contact
    let primaryContact = null;
    let payerContact = null;
    const contactRes = await fetch(
      `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
      { headers }
    );
    if (contactRes.ok) {
      const contactData = await contactRes.json();
      const allAssocs = contactData.results || [];
      const payerAssoc = allAssocs.find(r =>
        (r.associationTypes || []).some(a => a.label === 'Payer')
      );
      const primaryAssoc = allAssocs.find(r =>
        (r.associationTypes || []).some(a => a.label === 'Primary Contact')
      ) || allAssocs[0];

      // Fetch payer if exists
      if (payerAssoc) {
        const pRes = await fetch(
          `https://api.hubapi.com/crm/v3/objects/contacts/${payerAssoc.toObjectId}?properties=firstname,lastname,email`,
          { headers }
        );
        if (pRes.ok) {
          const p = await pRes.json();
          payerContact = {
            id: p.id,
            name: [p.properties.firstname, p.properties.lastname].filter(Boolean).join(' '),
            email: p.properties.email
          };
        }
      }

      // Fetch primary contact
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

    // Calculate expiration (120 days from now)
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 120);

    // Parse verbiage JSON
    let verbiage = {};
    try {
      verbiage = JSON.parse(deal.properties.po_quote_verbiage || '{}');
    } catch (e) { /* default empty */ }

    return res.status(200).json({
      dealId: deal.id,
      dealName: deal.properties.dealname || '',
      total,
      lineItems,
      primaryContact,
      payerContact,
      expirationDate: expDate.toISOString().split('T')[0],
      poFields: {
        addressee: deal.properties.po_quote_addressee || '',
        title: deal.properties.po_quote_title || '',
        notes: deal.properties.po_quote_notes || ''
      },
      verbiage,
      poQuoteStatus: deal.properties.po_quote_status || null,
      poQuoteLink: deal.properties.po_quote_link || null,
      poDocumentUrl: deal.properties.po_document_url || null,
      poReceivedDate: deal.properties.po_received_date || null
    });

  } catch (error) {
    console.error('Error fetching PO quote review data:', error.message);
    await reportError('sketch-review', '/api/po-quote-review', error, dealId);
    return res.status(500).json({ error: 'Failed to fetch data', details: error.message });
  }
}
