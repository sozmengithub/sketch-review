import crypto from 'crypto';

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { dealId, token, fileName, fileType, fileData } = req.body || {};

  if (!dealId || !token) return res.status(400).json({ error: 'dealId and token are required' });
  if (!validateToken(dealId, token)) return res.status(403).json({ error: 'Invalid or expired link' });
  if (!fileData || !fileName) return res.status(400).json({ error: 'fileName and fileData are required' });

  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg'];
  if (fileType && !allowedTypes.includes(fileType)) {
    return res.status(400).json({ error: 'File type not allowed. Please upload a PDF, PNG, or JPG.' });
  }

  // Strip data URL prefix to get raw base64
  const base64Raw = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const fileBuffer = Buffer.from(base64Raw, 'base64');
  const maxSize = 3 * 1024 * 1024; // 3MB
  if (fileBuffer.length > maxSize) {
    return res.status(400).json({ error: 'File is too large (max 3MB). Please email your PO to support@showoffinc.com.' });
  }

  const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
  if (!HUBSPOT_TOKEN) return res.status(500).json({ error: 'HubSpot token not configured' });

  const hsHeaders = {
    'Authorization': `Bearer ${HUBSPOT_TOKEN}`,
    'Content-Type': 'application/json'
  };

  let dealName = null;
  try {
    // Get deal name + quote title for file naming and notifications
    const dealRes = await fetch(
      `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,po_quote_title`,
      { headers: hsHeaders }
    );
    if (!dealRes.ok) return res.status(404).json({ error: 'Deal not found' });
    const deal = await dealRes.json();
    dealName = deal.properties.dealname || dealId;
    const quoteTitle = deal.properties.po_quote_title || dealName;

    // Get payer + primary contacts for confirmation emails (both should receive)
    let contactEmail = '';
    let contactName = '';
    let ccEmail = '';
    let ccName = '';
    try {
      const assocRes = await fetch(
        `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
        { headers: hsHeaders }
      );
      if (assocRes.ok) {
        const assocData = await assocRes.json();
        const allAssocs = assocData.results || [];

        // Find payer and primary by association label
        const payerAssoc = allAssocs.find(r =>
          (r.associationTypes || []).some(a => a.label === 'Payer')
        );
        const primaryAssoc = allAssocs.find(r =>
          (r.associationTypes || []).some(a => a.label === 'Primary Contact')
        ) || allAssocs[0];

        // Fetch payer contact details
        if (payerAssoc) {
          const pRes = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${payerAssoc.toObjectId}?properties=email,firstname,lastname`,
            { headers: hsHeaders }
          );
          if (pRes.ok) {
            const p = await pRes.json();
            contactEmail = p.properties.email || '';
            contactName = `${p.properties.firstname || ''} ${p.properties.lastname || ''}`.trim();
          }
        }

        // Fetch primary contact details
        if (primaryAssoc) {
          const cRes = await fetch(
            `https://api.hubapi.com/crm/v3/objects/contacts/${primaryAssoc.toObjectId}?properties=email,firstname,lastname`,
            { headers: hsHeaders }
          );
          if (cRes.ok) {
            const c = await cRes.json();
            const primaryEmail = c.properties.email || '';
            const primaryName = `${c.properties.firstname || ''} ${c.properties.lastname || ''}`.trim();

            if (!contactEmail) {
              // No payer — primary is the main recipient
              contactEmail = primaryEmail;
              contactName = primaryName;
            } else if (primaryEmail && primaryEmail !== contactEmail) {
              // Payer exists and is different — CC primary
              ccEmail = primaryEmail;
              ccName = primaryName;
            }
          }
        }
      }
    } catch (e) { /* contact fetch is best-effort */ }

    // Upload file to HubSpot Files API
    const ext = fileName.split('.').pop() || 'pdf';
    const hsFileName = `${dealName}_PO.${ext}`;

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer], { type: fileType || 'application/pdf' }), hsFileName);
    formData.append('options', JSON.stringify({
      access: 'PRIVATE',
      overwrite: false
    }));
    formData.append('folderPath', '/po-documents');

    const uploadRes = await fetch('https://api.hubapi.com/files/v3/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}` },
      body: formData
    });

    if (!uploadRes.ok) {
      const uploadErr = await uploadRes.text();
      throw new Error(`HubSpot file upload failed: ${uploadRes.status} ${uploadErr.substring(0, 300)}`);
    }

    const uploadData = await uploadRes.json();
    const fileId = uploadData.id;
    const fileUrl = uploadData.url;

    // Create Note engagement on deal with file attachment
    const engRes = await fetch('https://api.hubapi.com/engagements/v1/engagements', {
      method: 'POST',
      headers: hsHeaders,
      body: JSON.stringify({
        engagement: { active: true, type: 'NOTE', timestamp: Date.now() },
        associations: { dealIds: [Number(dealId)] },
        metadata: { body: `Purchase Order received from customer: ${fileName}` },
        attachments: [{ id: fileId }]
      })
    });

    if (!engRes.ok) {
      const engErr = await engRes.text();
      console.error('Note creation failed:', engErr.substring(0, 300));
      // Continue — file is uploaded, note is nice-to-have
    }

    // Update deal properties (including the native PO file property Erica uses)
    const today = new Date().toISOString().split('T')[0];
    const patchRes = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`, {
      method: 'PATCH',
      headers: hsHeaders,
      body: JSON.stringify({
        properties: {
          po_quote_status: 'PO Received',
          po_document_url: fileUrl,
          po_received_date: today,
          po: String(fileId),
          po_status: 'received'
        }
      })
    });
    if (!patchRes.ok) {
      const patchErr = await patchRes.text();
      console.error('Deal property update failed:', patchErr.substring(0, 300));
      // File is uploaded and Note is created — don't fail the whole request
    }

    // Fire n8n notification (must await — Vercel kills runtime after response)
    const dealUrl = `https://app.hubspot.com/contacts/46092307/record/0-3/${dealId}`;
    try {
      await fetch('https://showoffinc.app.n8n.cloud/webhook/po-received-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId, dealName, fileName, dealUrl, fileUrl, contactEmail, contactName, ccEmail, ccName, quoteTitle })
      });
    } catch (e) {
      console.error('PO notification webhook failed:', e.message);
    }

    return res.status(200).json({ success: true, fileUrl });

  } catch (error) {
    console.error('PO upload error:', error.message);
    await reportError('sketch-review', '/api/upload-po', error, dealId, dealName);
    return res.status(500).json({ error: 'Upload failed. Please try again or email your PO to support@showoffinc.com.', details: error.message });
  }
}
