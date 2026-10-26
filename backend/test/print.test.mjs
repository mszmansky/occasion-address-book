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

test('invitation pages: four to an Avery 8387 sheet, backs mirrored for long-edge two-sided printing', async () => {
  const { INVITE_MEDIA, invitePages } = await import('../../frontend/print-core.js');
  const avery = INVITE_MEDIA.avery8387;
  assert.equal(avery.sheet[0], avery.card[0] * avery.cols); // the cards fill the Letter sheet
  assert.equal(avery.sheet[1], avery.card[1] * avery.rows);
  assert.deepEqual(invitePages(5, avery), [
    { side: 'front', cells: [0, 1, 2, 3] }, { side: 'front', cells: [4, null, null, null] },
  ]);
  assert.deepEqual(invitePages(5, avery, { backs: true }), [
    { side: 'front', cells: [0, 1, 2, 3] }, { side: 'back', cells: [1, 0, 3, 2] },
    { side: 'front', cells: [4, null, null, null] }, { side: 'back', cells: [null, 4, null, null] },
  ]);
  assert.deepEqual(invitePages(2, INVITE_MEDIA.postcard4x6, { backs: true }).map((p) => [p.side, p.cells]),
    [['front', [0]], ['back', [0]], ['front', [1]], ['back', [1]]]);
  assert.deepEqual(invitePages(0, avery), []);
});

test('A2 envelopes for 4¼ × 5½ cards', async () => {
  const { ENVELOPES } = await import('../../frontend/print-core.js');
  const { Spy, calls } = spyPdf();
  const doc = buildEnvelopes(Spy, [['The Smiths', '12 Oak St', 'Troy, MI  48083']], { envelope: 'a2', returnLines: ['Mike', '1 Elm', 'Troy, MI  48083'] });
  assert.deepEqual(doc.internal.pageSize.getWidth().toFixed(2), '5.75');
  const a2 = ENVELOPES.a2;
  for (const c of calls) {
    assert.ok(c.x >= 0.25 && c.x < a2.page[0] - 0.25, `x ${c.x}`);
    assert.ok(c.y > 0.25 && c.y < a2.page[1] - 0.625, `y ${c.y} clears the barcode strip`);
  }
});

test('invitation orientation: single cards turn the page; Avery 8387 turns each design in its place', async () => {
  const { INVITE_MEDIA, inviteLayout } = await import('../../frontend/print-core.js');
  assert.deepEqual(inviteLayout(INVITE_MEDIA.card5x7), { sheet: [5, 7], card: [5, 7], landscape: false, rotateFront: false });
  assert.deepEqual(inviteLayout(INVITE_MEDIA.card5x7, 'landscape'), { sheet: [7, 5], card: [7, 5], landscape: true, rotateFront: false });
  assert.deepEqual(inviteLayout(INVITE_MEDIA.avery8387, 'landscape'), { sheet: [8.5, 11], card: [4.25, 5.5], landscape: true, rotateFront: true });
  assert.equal(inviteLayout(INVITE_MEDIA.avery8387, 'portrait').rotateFront, false);
});

test('Avery 5195 / 8195 / 18294 return labels: 60 per sheet, text inside each label', async () => {
  const { LABEL_SHEETS } = await import('../../frontend/print-core.js');
  const s = LABEL_SHEETS.avery5195;
  assert.equal(s.cols * s.rows, 60);
  const right = s.left + (s.cols - 1) * s.pitchX + s.width;
  assert.ok(Math.abs((8.5 - right) - s.left) < 0.01, 'equal side margins');
  assert.ok(Math.abs(s.top + s.rows * s.pitchY - 10.5) < 0.001, 'half-inch bottom margin');
  const ret = ['The Fitzgerald-Montgomery Family', '1044 Ridgeview Circle Apt 12', 'Lake Orion, MI  48360'];
  const { Spy, calls } = spyPdf();
  const doc = buildLabels(Spy, Array(61).fill(ret), { sheet: 'avery5195', start: 3 });
  assert.equal(doc.getNumberOfPages(), 2); // 58 on the first sheet, 3 on the second
  const firstLine = calls.filter((c) => c.page === 1 && (Array.isArray(c.t) ? c.t[0] : c.t) === ret[0]);
  assert.equal(firstLine.length, 58);
  // Every line starts inside its label and the label's text fits its height.
  for (const c of calls) {
    const col = Math.round((c.x - s.padX - s.left) / s.pitchX);
    assert.ok(col >= 0 && col < s.cols, `x ${c.x}`);
    const row = Math.floor((c.y - s.top) / s.pitchY);
    assert.ok(c.y > s.top + row * s.pitchY && c.y < s.top + (row + 1) * s.pitchY, `y ${c.y}`);
  }
});

test('envelopes with only the return address, to address by hand', async () => {
  const { Spy, calls } = spyPdf();
  const doc = buildEnvelopes(Spy, [[], []], { envelope: 'a2', returnLines: ['Mike', '1 Elm', 'Troy, MI  48083'] });
  assert.equal(doc.getNumberOfPages(), 2);
  assert.ok(calls.every((c) => c.x < 1 && c.y < 1.2), 'only the top-left corner is printed');
});
