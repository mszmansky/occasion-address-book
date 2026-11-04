import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsHtml, blockHtml, columnPixels, layoutOf, freeHtml, cardShape, ptToCqw, cqwToPt } from '../../frontend/layout-core.js';
import { cleanDesignHtml } from '../src/lib/sanitize.mjs';
import { renderDesign, isRowsDesign, isFreeDesign } from '../../frontend/design-core.js';

test('email rows are tables with a cell per column, and survive cleaning', () => {
  const html = rowsHtml([
    { layout: '1', cols: [[{ type: 'text', html: '<p>Dear {{greeting}},</p>' }]] },
    { layout: '1-2', bg: '#fdf2f8', cols: [[{ type: 'image', src: 'https://x.example/a.png', width: 100, align: 'center' }], [{ type: 'text', html: '<p>Hi</p>', bg: '#ffffff' }, { type: 'spacer', h: 30 }]] },
  ]);
  assert.ok(isRowsDesign(html));
  assert.equal((html.match(/<table data-row/g) ?? []).length, 2);
  assert.match(html, /<td data-col width="33.33%" valign="top" style="width:33.33%;vertical-align:top;padding:8px 8px">/);
  assert.match(html, /<img src="https:\/\/x.example\/a.png" alt="" width="184" style="width:100%;max-width:100%;height:auto;display:inline-block">/, 'Outlook gets the width in pixels');
  assert.match(html, /background-color:#fdf2f8/);
  assert.match(html, /<div data-block="text" style="padding:4px 0;background-color:#ffffff;padding:10px 12px"><p>Hi<\/p><\/div>/);
  const clean = cleanDesignHtml(html).replace(/ /g, '&nbsp;');
  assert.equal(clean.replace(/ \/>/g, '>'), html.replace(/<img src="([^"]*)" alt=""/, '<img alt="" src="$1"'));
  assert.match(renderDesign({ html }, { greeting: 'Kim' }), /Dear Kim,/);
});

test('blocks: sizes are kept in range', () => {
  assert.match(blockHtml({ type: 'spacer', h: 9999 }), /height:200px/);
  assert.match(blockHtml({ type: 'image', src: 'https://x/a.png', width: 50, align: 'right', border: '1px solid #000000', radius: '14px' }, 300),
    /text-align:right.*width="150" style="width:50%;max-width:100%;height:auto;display:inline-block;border:1px solid #000000;border-radius:14px"/);
  assert.equal(columnPixels('1-1-1', 0), 184);
  assert.equal(columnPixels('1', 0), 600);
  assert.equal(layoutOf([66, 34]), '2-1');
  assert.equal(layoutOf([100]), '1');
});

test('invitation parts are placed by percentages of the card', () => {
  const html = freeHtml({ size: 'postcard4x6', orient: 'landscape', shape: cardShape([4, 6], 'landscape'), items: [
    { type: 'image', x: 30, y: 4.123, w: 40, z: 1, html: '<img src="https://x.example/a.png" alt="" style="display:block;width:100%;height:auto">' },
    { type: 'text', x: 10, y: 50, w: 80, z: 2, html: '<p style="margin:0">{{greeting}}</p>' },
  ] });
  assert.ok(isFreeDesign(html));
  assert.match(html, /^<div data-free="postcard4x6" data-orient="landscape" data-aspect="6:4" style="position:absolute;inset:0">/);
  assert.match(html, /<div data-item="image" style="position:absolute;left:30%;top:4.12%;width:40%;z-index:1">/);
  assert.deepEqual(cardShape([5, 7], 'portrait'), [5, 7]);
  assert.equal(Math.round(ptToCqw(36, 5) * 100) / 100, 10);
  assert.equal(Math.round(cqwToPt(10, 5)), 36);
  assert.equal(cleanDesignHtml(html).replace(/ \/>/g, '>'), html.replace('<img src="https://x.example/a.png" alt=""', '<img alt="" src="https://x.example/a.png"'));
});
