// Save / Print / Share must never hand out an internal page (shop hours sheet,
// price breakdown). Made-up files only: this repository is public.
// Run: node --test tests/sketch-safety.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { checkShareable, kindOf, fileName } from '../api/_sketch-safety.js';

function pdf(pages, { compress = false } = {}) {
  let body = '%PDF-1.4\n';
  pages.forEach((txt, i) => {
    const content = `BT /F1 12 Tf 72 700 Td (${txt}) Tj ET`;
    const data = compress ? zlib.deflateSync(Buffer.from(content)) : Buffer.from(content);
    body += `${i * 2 + 1} 0 obj << /Type /Page /Contents ${i * 2 + 2} 0 R >> endobj\n`;
    body += `${i * 2 + 2} 0 obj << /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n` + data.toString('latin1') + '\nendstream endobj\n';
  });
  body += '99 0 obj << /Type /Pages /Count ' + pages.length + ' >> endobj\n%%EOF';
  return Buffer.from(body, 'latin1');
}

test('pictures are shareable', () => {
  assert.deepEqual(checkShareable(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), { ok: true, kind: 'jpg' });
  assert.deepEqual(checkShareable(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), { ok: true, kind: 'png' });
});
test('a drawing-only PDF (1 or 2 pages) is shareable, compressed or not', () => {
  assert.equal(checkShareable(pdf(['brick red tricot', 'nude mesh over nude lining'])).ok, true);
  assert.equal(checkShareable(pdf(['brick red tricot costume'], { compress: true })).ok, true);   // COSTUME is not COST
});
test('an internal page is refused, even compressed or split into pieces', () => {
  for (const words of ['PRICE BREAKDOWN:', 'PATTERNMAKING HOURS:', 'LABOR', 'Price']) {
    assert.equal(checkShareable(pdf(['drawing', words])).ok, false, words);
    assert.equal(checkShareable(pdf(['drawing', words], { compress: true })).ok, false, words + ' compressed');
  }
  const split = Buffer.from(pdf(['x']).toString('latin1').replace('(x)', '(PRI)-12(CE BREAKDOWN)'), 'latin1');
  assert.equal(checkShareable(split).ok, false, 'split text runs');
});
test('3 or more pages is refused (the old sheet + price + drawing packet)', () => {
  const r = checkShareable(pdf(['a', 'b', 'c']));
  assert.equal(r.ok, false); assert.equal(r.reason, 'too_many_pages');
});
test('anything else is refused', () => {
  assert.equal(checkShareable(Buffer.from('<html>hello</html>')).ok, false);
  assert.equal(checkShareable(Buffer.alloc(0)).ok, false);
  assert.equal(kindOf(null), '');
});
test('file names are plain and safe', () => {
  assert.equal(fileName({ nickname: "Nava - jazz solo / \"Why\" <b>" }, 'jpg'), 'Show Off sketch - Nava - jazz solo Why b.jpg');
  assert.equal(fileName({ number: '11067' }, 'pdf'), 'Show Off sketch - Order 11067.pdf');
  assert.equal(fileName({}, 'png'), 'Show Off sketch - design.png');
});
