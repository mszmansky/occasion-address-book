import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_STYLES, initialOf, renderReturnLabel, labelStyle } from '../../frontend/label-styles.js';

const lines = ['The Szmansky Family', '14 Cherry Lane', 'Evergreen Falls, MI  49001'];

test('every style renders the return address, escaped', () => {
  assert.equal(new Set(LABEL_STYLES.map((s) => s.id)).size, LABEL_STYLES.length);
  for (const s of LABEL_STYLES) {
    assert.ok(['Everyday', 'Holiday'].includes(s.group), s.id);
    const html = renderReturnLabel(s.id, ['Tom & <Ann>', '1 Elm', 'Troy, MI  48083'], { last: 'Smith' });
    assert.match(html, /^<div class="rl"/, s.id);
    assert.ok(html.includes('1 Elm') || html.includes('1 ELM'), s.id);
    assert.ok(!html.includes('<Ann>'), `${s.id} escapes`);
    assert.ok(!/<script|on\w+=/i.test(html), s.id);
  }
});

test('the monogram uses the last name\'s first letter', () => {
  assert.equal(initialOf('Szmansky', 'The Szmansky Family'), 'S');
  assert.equal(initialOf('', 'The Bartletts'), 'B');
  assert.equal(initialOf('', ''), '');
  assert.match(renderReturnLabel('monogram', lines, { last: 'Szmansky' }), />S<\/text>/);
  assert.match(renderReturnLabel('bold', lines, { last: 'Szmansky' }), /SZMANSKY/);
  assert.equal(labelStyle('nope').id, 'plain');
});
