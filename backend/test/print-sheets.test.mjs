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
});
