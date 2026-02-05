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

  try {
    // First try to get deal directly by ID
    let deal = null;
    let hubspotDealId = dealId;

    const directResponse = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,amount`,
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
            properties: ['dealname', 'amount'],
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
              properties: ['name', 'price', 'quantity', 'amount', 'description']
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
            description: item.properties.description || ''
          }));
        }
      }
    }

    // Calculate total
    const total = lineItems.reduce((sum, item) => sum + (item.amount || item.price * item.quantity), 0);

    return res.status(200).json({
      dealId: deal.id,
      dealName: deal.properties.dealname || 'Your Order',
      amount: parseFloat(deal.properties.amount) || total,
      lineItems: lineItems,
      total: total
    });

  } catch (error) {
    console.error('Error fetching deal:', error.message);
    return res.status(500).json({ error: 'Failed to fetch deal data', details: error.message });
  }
}
