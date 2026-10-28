// Cleans designed invitation HTML (from the design window or pasted in) before it's saved: only
// formatting tags and styles stay; scripts, event handlers, forms and frames go. The same HTML is
// shown to everyone the book is shared with and emailed to guests, so this runs on every save.

import sanitizeHtml from 'sanitize-html';

const LENGTH = /^-?\d+(\.\d+)?(px|em|rem|%|pt|in|cm|mm)?$/;
const LENGTHS = /^(-?\d+(\.\d+)?(px|em|rem|%|pt|in|cm|mm)?|auto)(\s+(-?\d+(\.\d+)?(px|em|rem|%|pt|in|cm|mm)?|auto)){0,3}$/;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\)|hsla?\(\s*[\d.\s,%deg]+\)|[a-z]{3,20})$/i;
const FONT_FAMILY = /^[\w\s'",-]{1,200}$/;
const BORDER = /^[\w\s#().,%-]{1,80}$/;

export const ALLOWED = {
  allowedTags: ['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup', 'small', 'big', 'font', 'center',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col'],
  allowedAttributes: {
    '*': ['style', 'align', 'dir', 'title', 'data-box'], // data-box: a Designer text box (its border style)
    a: ['href', 'target'],
    img: ['src', 'alt', 'width', 'height'],
    font: ['face', 'size', 'color'],
    table: ['width', 'border', 'cellpadding', 'cellspacing', 'bgcolor', 'role'],
    td: ['width', 'colspan', 'rowspan', 'valign', 'bgcolor'],
    th: ['width', 'colspan', 'rowspan', 'valign', 'bgcolor'],
    col: ['width', 'span'],
  },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https', 'http'] },
  allowProtocolRelative: false,
  allowedStyles: {
    '*': {
      color: [COLOR], 'background-color': [COLOR], background: [COLOR],
      'font-family': [FONT_FAMILY], 'font-size': [LENGTH, /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/],
      'font-weight': [/^(normal|bold|bolder|lighter|\d{3})$/], 'font-style': [/^(normal|italic|oblique)$/],
      'text-decoration': [/^[a-z\s-]{1,40}$/], 'text-decoration-line': [/^[a-z\s-]{1,40}$/], 'text-align': [/^(left|right|center|justify|start|end)$/],
      'text-transform': [/^(none|uppercase|lowercase|capitalize)$/], 'letter-spacing': [LENGTH, /^normal$/], 'line-height': [LENGTH, /^normal$/],
      'vertical-align': [/^(top|middle|bottom|baseline|sub|super|text-top|text-bottom)$/],
      margin: [LENGTHS], 'margin-top': [LENGTH, /^auto$/], 'margin-bottom': [LENGTH, /^auto$/], 'margin-left': [LENGTH, /^auto$/], 'margin-right': [LENGTH, /^auto$/],
      padding: [LENGTHS], 'padding-top': [LENGTH], 'padding-bottom': [LENGTH], 'padding-left': [LENGTH], 'padding-right': [LENGTH],
      width: [LENGTH, /^auto$/], 'max-width': [LENGTH, /^none$/], height: [LENGTH, /^auto$/], 'min-height': [LENGTH],
      border: [BORDER], 'border-top': [BORDER], 'border-bottom': [BORDER], 'border-left': [BORDER], 'border-right': [BORDER],
      'border-color': [COLOR], 'border-style': [/^[a-z\s]{1,40}$/], 'border-width': [LENGTHS], 'border-radius': [LENGTHS], 'border-collapse': [/^(collapse|separate)$/],
      display: [/^(block|inline|inline-block|none|table|table-cell|table-row)$/], float: [/^(left|right|none)$/],
      'white-space': [/^(normal|nowrap|pre|pre-wrap|pre-line)$/],
    },
  },
  // Links open in a new tab and images get alt text, so emails read well without images too.
  transformTags: {
    a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, target: '_blank' } }),
    img: (tag, attribs) => ({ tagName: 'img', attribs: { alt: '', ...attribs } }),
  },
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src, // a picture whose address was removed
  disallowedTagsMode: 'discard',
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head', 'iframe', 'object', 'embed', 'svg', 'math'],
};

export function cleanDesignHtml(html) {
  return sanitizeHtml(String(html ?? ''), ALLOWED).trim();
}
