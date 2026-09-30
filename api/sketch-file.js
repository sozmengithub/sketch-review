// GET /api/sketch-file?dealId=<HubSpot deal id>[&dl=1][&check=1]
// The customer's sketch file, and nothing else, for the Save / Print / Share
// buttons (Scott 2026-09-30). Same file the sketch page shows. Refuses any file
// that could carry internal pages (see _sketch-safety.js). ?check=1 answers
// JSON only ({ ok, kind, name } or { ok:false, reason }) so the buttons know
// whether to show. No prices, add-ons or order data ever come out of here.
import { checkShareable, fileName } from './_sketch-safety.js';

const MAX_BYTES = 30 * 1024 * 1024;     // read at most this much
const MAX_SEND = 4 * 1000 * 1000;        // Vercel answers are capped near 4.5 MB: bigger safe files are handed over by redirect
const TYPES = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

async function reportError(error, dealId) {
  try {
    await fetch('https://showoffinc.app.n8n.cloud/webhook/error-alert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: 'sketch-review', endpoint: '/api/sketch-file', error: String(error?.message || error), dealId: dealId || 'unknown', timestamp: new Date().toISOString() }),
    });
  } catch (_) { /* never block the answer on the alert */ }
}

function refuse(res, status, reason, wantsJson) {
  res.setHeader('Cache-Control', 'no-store');
  if (wantsJson) return res.status(status).json({ ok: false, reason });
  const msg = reason === 'no_sketch' ? 'There is no sketch on this order yet.'
    : reason === 'not_shareable' ? 'This sketch file cannot be shared from here. Please ask Erica at support@showoffinc.com for a copy you can share.'
    : 'The sketch could not be loaded right now. Please try again in a minute.';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(status).send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sketch</title><body style="font-family:-apple-system,Segoe UI,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#14201b;line-height:1.5"><p style="font-size:17px">${msg}</p></body>`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');           // the dashboard fetches the picture to share it
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const dealId = String(req.query.dealId || '').trim();
  const wantsJson = String(req.query.check || '') === '1';
  if (!/^\d{6,15}$/.test(dealId)) return refuse(res, 400, 'bad_request', wantsJson);
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return refuse(res, 500, 'not_configured', wantsJson);
  const H = { Authorization: `Bearer ${token}` };

  try {
    const d = await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=dealname,order_nickname__deal_,sketch,approved_sketch_link,sketch_public_url`, { headers: H });
    if (d.status === 404) return refuse(res, 404, 'no_sketch', wantsJson);
    if (!d.ok) throw new Error(`deal read ${d.status}`);
    const p = (await d.json()).properties || {};

    // Same order as the sketch page (api/deal.js): newest uploaded file first.
    let url = '';
    if (p.sketch) {
      const s = await fetch(`https://api.hubapi.com/files/v3/files/${encodeURIComponent(p.sketch)}/signed-url`, { headers: H });
      if (s.ok) url = (await s.json()).url || '';
    }
    url = url || p.approved_sketch_link || p.sketch_public_url || '';
    if (!url) return refuse(res, 404, 'no_sketch', wantsJson);
    if (!/^https:\/\/[^/]*hubspotusercontent[^/]*\//i.test(url)) return refuse(res, 409, 'not_shareable', wantsJson);   // only our own HubSpot files

    const f = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (ShowOff sketch-file)' } });
    if (!f.ok) throw new Error(`file fetch ${f.status}`);
    const len = Number(f.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return refuse(res, 409, 'not_shareable', wantsJson);
    const buf = Buffer.from(await f.arrayBuffer());
    if (buf.length > MAX_BYTES) return refuse(res, 409, 'not_shareable', wantsJson);

    const verdict = checkShareable(buf);
    if (!verdict.ok) {
      console.log('[sketch-file] refused', JSON.stringify({ dealId, ...verdict }));
      return refuse(res, 409, 'not_shareable', wantsJson);
    }
    const number = (String(p.dealname || '').match(/^\s*(\d{4,6}[A-Z]?)/) || [])[1] || '';
    const name = fileName({ nickname: p.order_nickname__deal_, number }, verdict.kind);

    res.setHeader('Cache-Control', 'private, max-age=300');
    if (wantsJson) return res.status(200).json({ ok: true, kind: verdict.kind, name });
    const disp = String(req.query.dl || '') === '1' ? 'attachment' : 'inline';
    if (buf.length > MAX_SEND) { res.setHeader('Cache-Control', 'no-store'); return res.redirect(302, url); }   // already checked safe above
    res.setHeader('Content-Type', TYPES[verdict.kind]);
    res.setHeader('Content-Disposition', `${disp}; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Content-Length', String(buf.length));
    return res.status(200).send(buf);
  } catch (e) {
    console.error('[sketch-file] failed', dealId, e?.message || e);
    await reportError(e, dealId);
    return refuse(res, 502, 'unavailable', wantsJson);
  }
}
