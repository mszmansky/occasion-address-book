import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { TEMPLATES, TEMPLATE_THEMES, templateDesign, artFile, artSvg, templateById } from '../../frontend/invite-templates.js';
import { FONTS, BORDERS, fontLink, renderDesign } from '../../frontend/design-core.js';
import { cleanDesignHtml } from '../src/lib/sanitize.mjs';

test('every theme has templates, each a normal design', () => {
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const theme of TEMPLATE_THEMES) assert.ok(TEMPLATES.filter((t) => t.theme === theme).length >= 3, theme);
  for (const t of TEMPLATES) {
    assert.ok(TEMPLATE_THEMES.includes(t.theme), t.id);
    const d = templateDesign(t, 'https://cards.example.com/media/abc.png');
    assert.ok(FONTS.some((f) => f.key === d.font), t.id);
    assert.ok(BORDERS.some((b) => b.key === d.border), t.id);
    for (const c of [d.background, d.color, d.borderColor]) assert.match(c, /^#[0-9a-f]{6}$/i, t.id);
    assert.match(d.html, /\{\{greeting\}\}/, t.id);
    assert.match(d.html, /\{\{from\}\}/, t.id);
    // Saving it keeps it as it is: the API's cleaning removes no tag or style.
    const clean = cleanDesignHtml(d.html);
    const styles = (h) => [...h.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    const tags = (h) => [...h.matchAll(/<(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(styles(clean), styles(d.html), t.id);
    assert.deepEqual(tags(clean), tags(d.html), t.id);
    assert.ok(fontLink(d).includes('fonts.googleapis.com'), `${t.id} loads its title font`);
    // The picture: an image file in frontend/art, or a drawing.
    if (artFile(t)) assert.ok(existsSync(new URL(`../../frontend/${artFile(t)}`, import.meta.url)), `${t.id} picture file`);
    else assert.match(artSvg(t, 3), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+" width="\d+" height="\d+">/, t.id);
    assert.ok(renderDesign(d, { greeting: 'Kim & Joe', from: 'Mike' }).includes('Kim &amp; Joe'), t.id);
  }
  assert.equal(templateById('nope'), null);
});
