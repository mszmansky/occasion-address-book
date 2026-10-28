import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanDesignHtml } from '../src/lib/sanitize.mjs';
import { buildInvite } from '../src/lib/email.mjs';
import { designText, fillFields, fontLink, longDate, renderDesign, starterHtml } from '../../frontend/design-core.js';

test('the backend copy of design-core matches the app\'s', async () => {
  const a = await readFile(new URL('../../frontend/design-core.js', import.meta.url), 'utf8');
  const b = await readFile(new URL('../src/lib/design-core.mjs', import.meta.url), 'utf8');
  assert.equal(b, a, 'copy frontend/design-core.js to backend/src/lib/design-core.mjs');
});

test('cleaning keeps formatting and drops anything active', () => {
  const dirty = `<p style="text-align:center;color:#9f1239;font-family:'Great Vibes', cursive;font-size:xx-large">Hi {{greeting}}</p>
    <script>alert(1)</script><img src="https://x.example/a.png" onerror="alert(1)" style="width:50%;max-width:100%">
    <a href="javascript:alert(1)">bad</a><a href="https://ok.example">ok</a><iframe src="https://x"></iframe>
    <div style="position:fixed;background-image:url(https://x)">x</div><font face="Georgia" color="red">f</font>
    <img src="data:image/png;base64,AAAA">`;
  const clean = cleanDesignHtml(dirty);
  assert.match(clean, /<p style="text-align:center;color:#9f1239;font-family:'Great Vibes', cursive;font-size:xx-large">Hi \{\{greeting\}\}<\/p>/);
  assert.match(clean, /<img alt="" src="https:\/\/x.example\/a.png" style="width:50%;max-width:100%" \/>/);
  assert.equal(clean.match(/<img/g).length, 1); // the data: picture is dropped entirely
  assert.match(clean, /<a href="https:\/\/ok.example" target="_blank">ok<\/a>/);
  assert.match(clean, /<font face="Georgia" color="red">f<\/font>/);
  for (const bad of ['script', 'alert', 'onerror', 'javascript', 'iframe', 'position', 'url(', 'data:']) assert.ok(!clean.includes(bad), bad);
});

test('fields fill in, escaped', () => {
  assert.equal(fillFields('<p>Dear {{greeting}}, {{ date }} {{nope}}</p>', { greeting: 'Tom & <Ann>', date: 'Saturday' }), '<p>Dear Tom &amp; &lt;Ann&gt;, Saturday {{nope}}</p>');
  assert.equal(longDate('2026-12-19'), 'Saturday, December 19, 2026');
  assert.equal(longDate(''), '');
  assert.equal(starterHtml('Come over!\n\nBring chips.'), '<p>Dear {{greeting}},</p><p>Come over!</p><p>Bring chips.</p>');
});

test('web fonts are linked only when used', () => {
  assert.equal(fontLink({ html: '<p>plain</p>', font: 'georgia' }), '');
  assert.equal(fontLink({ html: '<span style="font-family:\'Great Vibes\', cursive">x</span>', font: 'playfair' }),
    'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');
});

test('rendering wraps the design in its colors and font; text version reads well', () => {
  const r = renderDesign({ html: '<p>Hi {{greeting}}</p>', background: '#fef3c7', color: '#123456', font: 'cinzel' }, { greeting: 'Bob' });
  assert.match(r, /background:#fef3c7;color:#123456;font-family:Cinzel, Georgia, serif;/);
  assert.match(r, /<p>Hi Bob<\/p>/);
  assert.match(renderDesign({ html: 'x', background: 'red;evil' }), /background:#ffffff/);
  assert.equal(designText('<p>Dear {{greeting}},</p><ul><li>Wings</li><li>Beer &amp; chips</li></ul><p>See you<br>Mike</p>', { greeting: 'Bob' }),
    'Dear Bob,\n\n• Wings\n• Beer & chips\n\nSee you\nMike');
});

test('a designed email uses the design and the chosen greeting', () => {
  const occasion = {
    name: 'Football party', date: '2026-11-29', time: '1:00 PM', location: 'Our place',
    invite: { subject: 'Beer and wings' },
    design: { html: '<p style="font-family:\'Great Vibes\', cursive">Hey {{greeting}}!</p><p>{{date}} at {{time}}</p>', background: '#14532d', color: '#ffffff', font: 'arial' },
  };
  const msg = buildInvite({ occasion, household: { labelName: 'The Smith Family', greeting: 'John and Mary' }, fromName: 'Mike', greeting: 'John' });
  assert.equal(msg.subject, 'Beer and wings');
  assert.match(msg.html, /Hey John!/);
  assert.match(msg.html, /Sunday, November 29, 2026 at 1:00 PM/);
  assert.match(msg.html, /background:#14532d/);
  assert.match(msg.html, /fonts.googleapis.com\/css2\?family=Great\+Vibes/);
  assert.match(msg.text, /^Hey John!\n\nSunday, November 29, 2026 at 1:00 PM\n\nReply to this email to respond.$/);
  // Without a chosen greeting: the household's informal one.
  assert.match(buildInvite({ occasion, household: { labelName: 'The Smith Family', greeting: 'John and Mary' }, fromName: 'Mike' }).html, /Hey John and Mary!/);
});

test('borders frame the design; unknown values fall back', async () => {
  const { renderDesign: r } = await import('../../frontend/design-core.js');
  const framed = r({ html: '<p>x</p>', border: 'double', borderColor: '#14532d' }, {}, { padding: '32px' });
  assert.match(framed, /padding:calc\(32px \/ 2\)"><div class="design-frame" style="border:5px double #14532d;padding:calc\(32px \/ 2\);height:100%;box-sizing:border-box"><p>x<\/p><div style="clear:both"><\/div><\/div><\/div>$/);
  assert.match(r({ html: 'x', border: 'rounded', borderColor: 'nope' }), /border:2px solid #9f1239;border-radius:18px;/);
  assert.doesNotMatch(r({ html: 'x', border: 'weird' }), /design-frame/);
});

test('divider lines survive cleaning', () => {
  const hr = '<hr data-line="double" style="border:0;border-top:5px double #14532d;height:0;width:75%;margin:16px auto" />';
  assert.equal(cleanDesignHtml(hr), '<hr style="border:0;border-top:5px double #14532d;height:0;width:75%;margin:16px auto" />');
  const bar = '<hr style="border:0;height:4px;border-radius:2px;background-color:#9f1239;width:50%;margin:16px auto" />';
  assert.equal(cleanDesignHtml(bar), bar);
});

test('a Designer text box keeps its size, place, fill and border when saved', () => {
  const box = '<div data-box="rounded" align="center" style="width:60%;padding:12px;margin:12px auto;border:2px solid #9f1239;border-radius:12px;background-color:#fdf2f8;min-height:90px"><p style="margin:0">Hi</p></div>';
  assert.equal(cleanDesignHtml(box), box);
});
