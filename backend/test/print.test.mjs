import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import {
  addressLines, buildEnvelopes, buildLabels, envelopeName, isMailable, sortKey, LABEL_SHEETS,
} from '../../frontend/print-core.js';

// Records where text and outlines land without inspecting the PDF bytes.
function spyPdf() {
  const calls = [];
  // jsPDF attaches its methods per instance, so wrap the instance rather than subclassing.
  function Spy(opts) {
    const doc = new jsPDF(opts);
    const text = doc.text.bind(doc);
    doc.text = (t, x, y, ...rest) => { calls.push({ t, x, y, page: doc.getNumberOfPages() }); return text(t, x, y, ...rest); };
    return doc;
  }
  return { Spy, calls };
}

const addr = { line1: '123 Maple St', line2: 'Apt 4', city: 'Troy', state: 'MI', zip: '48083' };

test('address lines', () => {
  assert.deepEqual(addressLines('The Smiths', addr), ['The Smiths', '123 Maple St', 'Apt 4', 'Troy, MI  48083']);
  assert.deepEqual(addressLines('X', { line1: '1 A', city: 'Toronto', state: 'ON', zip: 'M5V 2T6', country: 'Canada' }).at(-1), 'CANADA');
  assert.equal(addressLines('X', { ...addr, country: 'USA' }).length, 4);
  assert.ok(isMailable(addr));
  assert.ok(!isMailable({ line1: '1 A', city: 'Troy' }));
  assert.equal(envelopeName({ labelName: 'The Smiths', formalName: 'Mr. and Mrs. J. Smith' }, 'formal'), 'Mr. and Mrs. J. Smith');
  assert.equal(envelopeName({ labelName: 'The Smiths' }, 'formal'), 'The Smiths');
  assert.equal(envelopeName({ labelName: 'The Smiths', greeting: 'John and Mary' }, 'informal'), 'John and Mary');
  assert.equal(envelopeName({ labelName: 'The Smiths', greeting: ' ' }, 'informal'), 'The Smiths');
  assert.equal(sortKey({ labelName: 'The Smith Family' }), 'smith');
  assert.equal(sortKey({ labelName: 'Bob & Sue', members: [{ firstName: 'Bob', lastName: 'Jones' }] }), 'jones');
});

test('Avery 5160: 30 per page, positions match the sheet, start offset skips used labels', () => {
  const { Spy, calls } = spyPdf();
  const items = Array.from({ length: 35 }, (_, i) => addressLines(`Household ${i + 1}`, addr));
  const doc = buildLabels(Spy, items, { start: 4 });
  // 3 used + 35 = 38 slots → 2 pages
  assert.equal(doc.getNumberOfPages(), 2);
  const firstNames = calls.filter((c) => c.t.startsWith('Household'));
  assert.equal(firstNames.length, 35);
  const s = LABEL_SHEETS.avery5160;
  // Household 1 is label #4: row 2, column 1.
  const h1 = firstNames[0];
  assert.equal(h1.page, 1);
  assert.ok(Math.abs(h1.x - (s.left + s.padX)) < 1e-9);
  assert.ok(h1.y > s.top + s.pitchY && h1.y < s.top + 2 * s.pitchY);
  // Household 28 is the 31st slot → first label of page 2.
  const h28 = firstNames[27];
  assert.equal(h28.page, 2);
  assert.ok(h28.y > s.top && h28.y < s.top + s.height);
  // Every line stays inside its label horizontally.
  for (const c of calls) {
    const col = Math.round((c.x - s.left - s.padX) / s.pitchX);
    assert.ok(col >= 0 && col < 3);
  }
});

test('long names wrap at a readable size; anything still too long is clipped, never overflowing', () => {
  const s = LABEL_SHEETS.avery5160;
  const maxWidth = s.width - 2 * s.padX;
  const check = (lines) => {
    const { Spy, calls } = spyPdf();
    const sizes = [];
    const doc = buildLabels(function Sized(o) { const d = new Spy(o); const set = d.setFontSize.bind(d); d.setFontSize = (pt) => { sizes.push(pt); return set(pt); }; return d; }, [lines]);
    doc.setFontSize(Math.min(...sizes));
    for (const c of calls) assert.ok(doc.getTextWidth(c.t) <= maxWidth + 1e-6, `"${c.t}" overflows`);
    return { calls, pt: sizes.at(-1) };
  };
  const wrapped = check(addressLines('Mr. and Mrs. Jonathan Featherstonehaugh III and Family', addr));
  assert.equal(wrapped.calls.length, 5, 'name wrapped onto two lines');
  assert.ok(wrapped.pt >= 8, `readable size, got ${wrapped.pt}`);
  const clipped = check(addressLines('X'.repeat(200), addr));
  assert.ok(clipped.calls.some((c) => c.t.endsWith('…')));
});

test('offsets move everything', () => {
  const a = spyPdf(); buildLabels(a.Spy, [['A', 'B']]);
  const b = spyPdf(); buildLabels(b.Spy, [['A', 'B']], { offsetX: 0.1, offsetY: -0.05 });
  assert.ok(Math.abs(b.calls[0].x - a.calls[0].x - 0.1) < 1e-9);
  assert.ok(Math.abs(b.calls[0].y - a.calls[0].y + 0.05) < 1e-9);
});

test('A7 envelopes: one per page, landscape 7.25 x 5.25, return address top-left', () => {
  const { Spy, calls } = spyPdf();
  const doc = buildEnvelopes(Spy, [addressLines('The Smiths', addr), addressLines('The Lees', addr)], { returnLines: ['Mike S', '1 Home Rd', 'Troy, MI  48083'] });
  assert.equal(doc.getNumberOfPages(), 2);
  const size = doc.internal.pageSize;
  assert.ok(Math.abs(size.getWidth() - 7.25) < 0.01 && Math.abs(size.getHeight() - 5.25) < 0.01);
  const ret = calls.find((c) => c.t === 'Mike S');
  assert.ok(ret.x < 1 && ret.y < 1);
  const to = calls.find((c) => c.t === 'The Smiths');
  assert.ok(to.x > 2.5 && to.y > 2 && to.y < 3.5);
});

test('incomplete addresses say what is missing', async () => {
  const { addressProblem } = await import('../../frontend/print-core.js');
  assert.equal(addressProblem({ line1: '1 Riverfront Center W', line2: 'Apt 804', city: 'Flint', state: 'MI', zip: '' }), 'Missing ZIP');
  assert.equal(addressProblem({ state: 'MI' }), 'Missing street, city and ZIP');
  assert.equal(addressProblem({ city: 'Flint', zip: '48502' }), 'Missing street');
  assert.equal(addressProblem({}), 'No mailing address');
  assert.equal(addressProblem(undefined), 'No mailing address');
  assert.equal(addressProblem({ line1: '1 Main', city: 'Flint', zip: '48502' }), '');
});
