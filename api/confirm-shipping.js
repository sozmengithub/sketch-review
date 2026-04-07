async function reportError(system, endpoint, error, dealId) {
  try {
    await fetch('https://showoffinc.app.n8n.cloud/webhook/error-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, endpoint, error: error.message || String(error), dealId: dealId || 'unknown', timestamp: new Date().toISOString() })
    });
  } catch (e) { /* silent */ }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { dealId, address } = req.body;
  if (!dealId) {
    return res.status(400).json({ error: 'dealId is required' });
  }

  const headers = {
    'Authorization': `Bearer ${process.env.HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  try {
    // If address provided, update it first
    const properties = { shipping_address_confirmed_date: new Date().toISOString() };
    if (address && address.street) {
      properties.shipping_street_address__deal_ = address.street || '';
      properties.shipping_street_address_2__deal_ = address.street2 || '';
      properties.shipping_city = address.city || '';
      properties.shipping_state = address.state || '';
      properties.shipping_zip_code = address.zip || '';
    }

    // Set confirmed date (and optionally update address)
    const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ properties })
    });

    if (!updateRes.ok) {
      const err = await updateRes.text();
      throw new Error('HubSpot update failed: ' + err);
    }

    // Get address for audit note
    const dealRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=shipping_street_address__deal_,shipping_street_address_2__deal_,shipping_city,shipping_state,shipping_zip_code`,
      { headers }
    );

    if (dealRes.ok) {
      const deal = await dealRes.json();
      const addr = [
        deal.properties.shipping_street_address__deal_,
        deal.properties.shipping_street_address_2__deal_,
        [deal.properties.shipping_city, deal.properties.shipping_state, deal.properties.shipping_zip_code].filter(Boolean).join(', ')
      ].filter(Boolean).join(', ');

      // Create audit note
      const noteRes = await fetch('https://api.hubapi.com/crm/v3/objects/notes', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            hs_note_body: 'Shipping address confirmed by customer during sketch approval.\n\nAddress: ' + addr,
            hs_timestamp: new Date().toISOString()
          }
        })
      });

      if (noteRes.ok) {
        const note = await noteRes.json();
        await fetch(
          `https://api.hubapi.com/crm/v4/objects/notes/${note.id}/associations/deals/${dealId}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify([{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }])
          }
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Confirm shipping error:', error.message);
    await reportError('sketch-review', '/api/confirm-shipping', error, dealId);
    return res.status(500).json({ error: 'Failed to confirm shipping address' });
  }
}
