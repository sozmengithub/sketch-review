// What may leave through the Save / Print / Share buttons (Scott 2026-09-30).
// Only the customer's drawing. Last season's sketch files are 3-page packets:
// the shop's hours sheet + our PRICE BREAKDOWN (labor, markup) + the drawing
//. Those must never be shared. Pictures are
// fine; a PDF is fine only if nothing in it reads like an internal page.
// Fails CLOSED: anything we cannot read is not shareable.
import zlib from 'node:zlib';

export const BLOCK_WORDS = ['PRICE BREAKDOWN', 'PRICE', 'HOURS', 'LABOR', 'PATTERNMAKING', 'MARKUP', 'COST'];
export const MAX_PDF_PAGES = 2;

export function kindOf(buf) {
  if (!buf || buf.length < 8) return '';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return '';
}

// Text a PDF shows, as far as we can decode it: raw bytes + every inflatable stream.
export function pdfText(buf) {
  const raw = buf.toString('latin1');
  let text = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    const chunk = buf.subarray(start, end);
    try { text += zlib.inflateSync(chunk).toString('latin1'); }
    catch (_) { try { text += zlib.inflateRawSync(chunk).toString('latin1'); } catch (_) { /* image or font data */ } }
    re.lastIndex = end;
  }
  // Glue split text runs: (PRI)12(CE) -> PRICE
  return (raw + '\n' + text).toUpperCase().replace(/\)\s*-?\d*\.?\d*\s*\(/g, '');
}

export function pdfPages(buf) {
  return (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
}

// -> { ok: true, kind } or { ok: false, reason }
export function checkShareable(buf) {
  const kind = kindOf(buf);
  if (kind === 'jpg' || kind === 'png') return { ok: true, kind };
  if (kind !== 'pdf') return { ok: false, reason: 'unknown_file' };
  const pages = pdfPages(buf);
  if (pages > MAX_PDF_PAGES) return { ok: false, reason: 'too_many_pages', pages };
  const t = pdfText(buf);
  const hit = BLOCK_WORDS.find((w) => new RegExp('\\b' + w + '\\b').test(t));
  if (hit) return { ok: false, reason: 'internal_page', word: hit };
  return { ok: true, kind };
}

// "Show Off sketch - Nava Berezin jazz solo.jpg": order nickname if we have one.
export function fileName({ nickname = '', number = '' } = {}, kind = 'jpg') {
  const base = String(nickname || (number ? 'Order ' + number : 'design')).replace(/[^\w .,'()&-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'design';
  return `Show Off sketch - ${base}.${kind}`;
}
