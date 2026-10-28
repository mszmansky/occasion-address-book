import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelSheetsHtml, envelopesHtml } from '../../frontend/print-sheets.js';

const pages = (html) => html.match(/<section class="page/g)?.length ?? 0;
const slots = (html) => [...html.matchAll(/class="slot[^"]*" style="left:([\d.]+)in;top:([\d.]+)in">(.*?)<\/div>(?=<div class="slot|<\/section>)/gs)];

test('labels fill the sheet from the starting label, onto more sheets as needed', () => {
  const items = Array.from({ length: 30 }, (_, i) => `<div class="rl">L${i}</div>`);
  const { body, css, pageSize } = labelSheetsHtml(items, { sheet: 'avery5160', start: 4 });
  assert.deepEqual(pageSize, [8.5, 11]);
  assert.equal(pages(body), 2);
  const s = slots(body);
  assert.equal(s.length, 30); // empty slots aren't drawn without outlines
  assert.deepEqual([s[0][1], s[0][2]], ['0.1875', '1.5']); // label 4 = row 2, column 1
  assert.match(css, /@page \{ size: 8.5in 11in; margin: 0; \}/);
  assert.match(css, /\.slot \{ position: absolute; width: 2.625in; height: 1in; font-size: 1in; \}/);
});

test('return labels: Avery 5195 geometry, printer offsets, outlines on every label', () => {
  const { body, css } = labelSheetsHtml(['<div class="rl">R</div>'], { sheet: 'avery5195', start: 60, offsetX: 0.05, offsetY: -0.02, outline: true });
  assert.equal(pages(body), 1);
  assert.equal((body.match(/class="slot outlined"/g) ?? []).length, 60);
  assert.match(body, /left:6.5175in;top:9.8133in"><div class="rl">R<\/div>/); // label 60: column 4, row 15, nudged
  assert.match(css, /height: 0.6667in; font-size: 0.6667in;/);
});

test('envelopes: recipient centred on its line, return address top-left, or return address only', () => {
  const { body, css, pageSize } = envelopesHtml([
    { to: ['The Smiths', '12 Oak St', 'Troy, MI  48083'], ret: ['Mike', '1 Elm', 'Troy, MI  48083'] },
    { to: [], ret: ['Mike', '1 Elm', 'Troy, MI  48083'] },
  ], { envelope: 'a2' });
  assert.deepEqual(pageSize, [5.75, 4.375]);
  assert.equal(pages(body), 2);
  assert.match(css, /@page \{ size: 5.75in 4.375in; margin: 0; \}/);
  assert.match(body, /class="txt to" style="left:2.05in;top:1.6in;width:3.4in;height:1.7in;font-size:11.5pt">.*The Smiths/s);
  assert.equal((body.match(/class="txt to"/g) ?? []).length, 1);
  assert.equal((body.match(/class="txt ret"/g) ?? []).length, 2);
  assert.ok(!envelopesHtml([{ to: ['<b>x</b>'] }]).body.includes('<b>'));
  assert.ok(!css.includes('.rl {'), 'label styles only when a design is used');
});

test('envelopes: the return address as a label design in the corner', () => {
  const { body, css } = envelopesHtml([{ to: ['The Smiths', '12 Oak St', 'Troy, MI  48083'], retLabel: '<div class="rl">R</div>' }], { envelope: 'a7', offsetX: 0.1 });
  assert.match(body, /<div class="retl" style="left:0.45in;top:0.38in"><div class="rl">R<\/div><\/div>/);
  assert.match(css, /\.retl \{ position: absolute; font-size: 0.85in; \}/);
  assert.ok(css.includes('.rl {'));
  assert.equal((body.match(/class="txt ret"/g) ?? []).length, 0);
});

test('every envelope size lays out inside its page, the recipient clear of the return address', async () => {
  const { ENVELOPES, usedEnvelopes } = await import('../../frontend/print-core.js');
  for (const [k, e] of Object.entries(ENVELOPES)) {
    const [w, h] = e.page;
    assert.ok(e.toLeft + e.toMaxWidth <= w, `${k} recipient fits across`);
    assert.ok(e.toCenterY - 0.85 >= 0 && e.toCenterY + 0.85 <= h, `${k} recipient fits down`);
    // The return address (a block 1.2 in tall) stays left of the recipient, or above it.
    assert.ok(e.returnAt[0] + e.returnMaxWidth <= e.toLeft + 0.01 || e.returnAt[1] + 1.2 <= e.toCenterY - 0.85 + 0.01, `${k} return address clear of the recipient`);
    assert.ok(e.returnAt[1] + e.returnLabelIn <= e.toCenterY - 0.85 + 0.01, `${k} a return design stays above the recipient`);
    const { pageSize } = envelopesHtml([{ to: ['A', 'B', 'C'], ret: ['R'] }], { envelope: k });
    assert.deepEqual(pageSize, [w, h]);
  }
  assert.deepEqual(usedEnvelopes(), ['a2', 'a7']);
  assert.deepEqual(usedEnvelopes(['n10', 'a2', 'nope']), ['a2', 'n10']);
});
