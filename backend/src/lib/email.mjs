// Email bodies (HTML + plain text): invitations, address-update requests and the
// "address updated" notice to the account owner.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]);

export const fmtDate = (iso) => (iso
  ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  : '');

import { designText, fieldValues, fontLink, renderDesign } from './design-core.mjs';

// Plain text the user typed → paragraphs, keeping single line breaks.
const paragraphs = (text) => String(text ?? '').trim().split(/\n{2,}/).filter(Boolean)
  .map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

function layout({ heading, inner, footer }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2dfd8;border-radius:10px">
<tr><td style="padding:28px 28px 8px;font:15px/1.55 Arial,sans-serif;color:#1d2125">
${heading ? `<h1 style="font:600 21px/1.3 Arial,sans-serif;margin:0 0 16px;color:#1d2125">${esc(heading)}</h1>` : ''}
${inner}
</td></tr>
<tr><td style="padding:8px 28px 24px;font:12.5px/1.5 Arial,sans-serif;color:#868e96">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (url, label) => `<p style="margin:22px 0"><a href="${esc(url)}" style="display:inline-block;background:#9f1239;color:#ffffff;text-decoration:none;font:600 15px Arial,sans-serif;padding:11px 20px;border-radius:8px">${esc(label)}</a></p>`;

/**
 * Invitation to an occasion.
 * @param {object} p
 * @param {object} p.occasion   { name, date, time, location, invite: { subject, message } }
 * @param {object} p.household  { labelName }
 * @param {string} p.fromName   who it's from, e.g. "Mike Szmansky"
 */
// RSVP buttons (Yes / Maybe / No) and "Add to calendar", under the invitation. rsvp: { url (the RSVP
// page for this household), icsUrl (its calendar file) }.
function rsvpBlock(rsvp) {
  if (!rsvp?.url) return { html: '', text: '' };
  const btn = (a, label, bg) => `<a href="${esc(`${rsvp.url}&a=${a}`)}" style="display:inline-block;margin:4px;background:${bg};color:#ffffff;text-decoration:none;font:600 15px Arial,sans-serif;padding:10px 20px;border-radius:8px">${label}</a>`;
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0 4px"><tr><td align="center" style="font:600 16px Arial,sans-serif;color:#1d2125;padding-bottom:6px">Will you be there?</td></tr>
<tr><td align="center">${btn('yes', 'Yes', '#2f7d4f')}${btn('maybe', 'Maybe', '#8a6d1d')}${btn('no', 'No', '#868e96')}</td></tr>
${rsvp.icsUrl ? `<tr><td align="center" style="padding-top:10px;font:14px Arial,sans-serif"><a href="${esc(rsvp.icsUrl)}" style="color:#9f1239">Add to calendar</a></td></tr>` : ''}</table>`;
  const text = `Will you be there? RSVP: ${rsvp.url}${rsvp.icsUrl ? `\nAdd to calendar: ${rsvp.icsUrl}` : ''}`;
  return { html, text };
}

export function buildInvite({ occasion, household, fromName, greeting: chosen, test = false, rsvp = null }) {
  const inv = occasion.invite ?? {};
  const subject = `${test ? '[Test] ' : ''}${inv.subject || `You're invited: ${occasion.name}`}`;
  const greeting = chosen || household?.greeting || household?.labelName || '';
  const r = rsvpBlock(rsvp);
  if (occasion.design?.html) return designedEmail({ occasion, greeting, fromName, subject, rsvp: r });
  const details = [
    occasion.date && ['When', [fmtDate(occasion.date), occasion.time].filter(Boolean).join(' at ')],
    occasion.location && ['Where', occasion.location],
  ].filter(Boolean);

  const detailHtml = details.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;font:15px/1.5 Arial,sans-serif">
    ${details.map(([k, v]) => `<tr><td style="padding:3px 16px 3px 0;color:#868e96;vertical-align:top">${k}</td><td style="padding:3px 0;color:#1d2125;white-space:pre-line">${esc(v)}</td></tr>`).join('')}
  </table>` : '';

  const html = layout({
    heading: occasion.name,
    inner: `${greeting ? `<p style="margin:0 0 14px">Dear ${esc(greeting)},</p>` : ''}
      ${paragraphs(inv.message)}
      ${detailHtml}
      ${fromName ? `<p style="margin:0 0 14px">— ${esc(fromName)}</p>` : ''}
      ${r.html}`,
    footer: `Reply to this email to respond${fromName ? ` to ${esc(fromName)}` : ''}.`,
  });

  const text = [
    occasion.name,
    '',
    greeting && `Dear ${greeting},`,
    greeting && '',
    String(inv.message ?? '').trim(),
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    details.length ? '' : null,
    fromName && `— ${fromName}`,
    '',
    r.text || null,
    r.text ? '' : null,
    'Reply to this email to respond.',
  ].filter((l) => l !== null && l !== undefined && l !== false).join('\n');

  return { subject, html, text };
}

// A designed email: the design itself, centered, with a one-line footer. Web fonts are linked for
// mail apps that load them (Apple Mail); others use each font's fallback.
function designedEmail({ occasion, greeting, fromName, subject, rsvp = { html: '', text: '' } }) {
  const values = fieldValues({ occasion, greeting, fromName });
  const link = fontLink(occasion.design);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${link ? `<link href="${esc(link)}" rel="stylesheet">` : ''}
<style>.design img{max-width:100%;height:auto}.design p{margin:0 0 12px}</style></head>
<body style="margin:0;background:#f4f2ee;padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px"><tr><td>
${renderDesign(occasion.design, values)}
</td></tr>
${rsvp.html ? `<tr><td style="background:#ffffff;padding:6px 12px 14px">${rsvp.html}</td></tr>` : ''}
<tr><td style="padding:14px 4px;font:12.5px/1.5 Arial,sans-serif;color:#868e96;text-align:center">Reply to this email to respond${fromName ? ` to ${esc(fromName)}` : ''}.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${designText(occasion.design.html, values)}\n\n${rsvp.text ? `${rsvp.text}\n\n` : ''}Reply to this email to respond.`;
  return { subject, html, text };
}

/** "Your password was changed": sent after a change in Settings and after a Forgot-password reset. */
export function buildPasswordChanged({ email, when = new Date(), timeZone, appUrl }) {
  const APP = 'Occasions Address Book';
  let at;
  try {
    at = when.toLocaleString('en-US', { timeZone: timeZone || 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    at = when.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
  }
  const subject = `Your ${APP} password was changed`;
  const html = layout({
    heading: 'Your password was changed',
    inner: `<p style="margin:0 0 14px">The password for <b>${esc(email)}</b> was changed on ${esc(at)}.</p>
      <p style="margin:0 0 14px">If that was you, there's nothing more to do.</p>
      <p style="margin:0 0 14px"><b>If it wasn't you,</b> reset your password right away: open ${APP}, choose <b>Forgot password?</b>, and enter your email.</p>
      ${appUrl ? button(appUrl, `Open ${APP}`) : ''}`,
    footer: 'This is an automatic security notice. You get it whenever your password changes.',
  });
  const text = `The password for ${email} was changed on ${at}.

If that was you, there's nothing more to do.

If it wasn't you, reset your password right away: open ${APP}${appUrl ? ` (${appUrl})` : ''}, choose Forgot password?, and enter your email.`;
  return { subject, html, text };
}

/** Asks a household to confirm or correct their mailing address through a private link. */
export function buildAddressRequest({ household, fromName, url, message, expiresDays }) {
  const who = fromName || 'A friend';
  const subject = `${who} would like your current mailing address`;
  const html = layout({
    heading: 'Is your address up to date?',
    inner: `<p style="margin:0 0 14px">Hi ${esc(household.greeting || household.labelName)},</p>
      ${message ? paragraphs(message) : `<p style="margin:0 0 14px">${esc(who)} is updating their address book for cards and invitations. Please take a moment to confirm or correct your mailing address.</p>`}
      ${button(url, 'Confirm my address')}
      <p style="margin:0 0 14px;font-size:13px;color:#545b63">The link is just for you and works for ${expiresDays} days. Only ${esc(who)} sees what you enter.</p>`,
    footer: `Sent on behalf of ${esc(who)}. If you weren't expecting this, you can ignore it.`,
  });
  const text = `Hi ${household.greeting || household.labelName},

${message ? String(message).trim() : `${who} is updating their address book for cards and invitations. Please take a moment to confirm or correct your mailing address.`}

Confirm my address: ${url}

The link is just for you and works for ${expiresDays} days. Only ${who} sees what you enter.`;
  return { subject, html, text };
}

/** Tells the account owner that a household sent back their address. */
export function buildAddressReceived({ household, update, appUrl }) {
  const a = update.address ?? {};
  const lines = [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ` ${a.zip}` : ''), a.country]
    .map((l) => (l ?? '').trim()).filter(Boolean);
  const subject = `${household.labelName} sent their address`;
  const html = layout({
    heading: `${household.labelName} replied`,
    inner: `<p style="margin:0 0 10px">They ${update.unchanged ? 'confirmed their address is still' : 'sent this address'}:</p>
      <p style="margin:0 0 14px;padding:12px 14px;background:#faf9f6;border:1px solid #e2dfd8;border-radius:8px">${lines.map(esc).join('<br>')}</p>
      ${update.note ? `<p style="margin:0 0 14px"><b>Note:</b> ${esc(update.note)}</p>` : ''}
      <p style="margin:0 0 14px">${update.unchanged ? 'Nothing needs to change.' : 'Open your address book to review and accept it; nothing changes until you do.'}</p>
      ${button(appUrl, 'Open address book')}`,
    footer: 'You asked them to confirm their address from your address book.',
  });
  const text = `${household.labelName} ${update.unchanged ? 'confirmed their address is still' : 'sent this address'}:

${lines.join('\n')}
${update.note ? `\nNote: ${update.note}\n` : ''}
${update.unchanged ? 'Nothing needs to change.' : 'Open your address book to review and accept it; nothing changes until you do.'}
${appUrl}`;
  return { subject, html, text };
}

/**
 * Emails Cognito sends (invitation with a temporary password, password-reset code, email-change code),
 * in the same style as the app's other emails. Cognito fills in the {####} code and {username} placeholders,
 * so they must appear in the message exactly as given.
 */
// The app opens a link ending in #signin=<email> at Sign in with the email filled in.
const signinUrl = (appUrl, email) => `${String(appUrl).replace(/\/$/, '')}/#signin=${email}`;

export function buildCognitoMessage(triggerSource, { appUrl, codeParameter = '{####}', usernameParameter = '{username}' } = {}) {
  const APP = 'Occasions Address Book';
  const code = `<p style="margin:0 0 14px"><span style="display:inline-block;font:700 24px/1.2 'Courier New',Courier,monospace;letter-spacing:4px;background:#faf9f6;border:1px solid #e2dfd8;border-radius:6px;padding:10px 14px">${codeParameter}</span></p>`;
  const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
  const make = (subject, heading, inner, footer) => ({ subject, html: layout({ heading, inner, footer }) });
  switch (triggerSource) {
    case 'CustomMessage_AdminCreateUser':
      return make(`You're invited to ${APP}`, `You're invited to ${APP}`,
        p(`${APP} keeps your mailing list for cards and invitations, prints labels and envelopes, and emails invitations.`)
        + p(`Sign in with <b>${usernameParameter}</b> and this temporary password:`)
        + code
        + p("You'll choose your own password when you first sign in. The temporary password works for 30 days.")
        + (appUrl ? button(signinUrl(appUrl, usernameParameter), `Sign in to ${APP}`) : ''),
        "If you weren't expecting this invitation, you can ignore this email.");
    case 'CustomMessage_ForgotPassword':
      return make(`Your ${APP} password reset code`, 'Reset your password',
        p(`Enter this code in ${APP} to choose a new password:`) + code + p('The code expires in 1 hour.'),
        "If you didn't ask to reset your password, you can ignore this email. Your password won't change.");
    case 'CustomMessage_UpdateUserAttribute':
    case 'CustomMessage_VerifyUserAttribute':
      return make(`Confirm your new ${APP} email`, 'Confirm your new email address',
        p(`Enter this code in ${APP} to make this your sign-in email:`) + code + p('The code expires in 24 hours. Until then, keep signing in with your current address.'),
        "If you didn't ask to change your email, you can ignore this email.");
    default: // sign-up and resend codes (sign-up is invite-only, but Cognito may still send these)
      return make(`Your ${APP} verification code`, 'Your verification code',
        p(`Enter this code in ${APP}:`) + code,
        "If you didn't request this, you can ignore this email.");
  }
}

/** Tells someone an address book was shared with them (and, if new, that an invitation email is coming). */
export function buildShareNotice({ ownerName, ownerEmail, role, invited, appUrl, to = '' }) {
  const APP = 'Occasions Address Book';
  const who = ownerName || ownerEmail;
  const access = role === 'edit'
    ? 'You can add and update addresses, plan occasions, print labels and envelopes, and send invitations.'
    : 'You can look up addresses and print labels and envelopes (view only).';
  const signIn = invited
    ? `You'll also get an email with a temporary password. Sign in to ${APP} with this email address and that password, then choose your own.`
    : `Sign in to ${APP} with this email address to see it.`;
  const subject = `${who} shared their address book with you`;
  const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
  const html = layout({
    heading: `${who} shared their address book`,
    inner: p(`${esc(who)}${ownerName ? ` (${esc(ownerEmail)})` : ''} shared their ${APP} with you: their addresses and occasions such as holiday cards and parties.`)
      + p(esc(access)) + p(esc(signIn)) + (appUrl ? button(to ? signinUrl(appUrl, encodeURIComponent(to)) : appUrl, `Open ${APP}`) : ''),
    footer: "If you weren't expecting this, you can ignore this email.",
  });
  const text = `${who}${ownerName ? ` (${ownerEmail})` : ''} shared their ${APP} with you: their addresses and occasions such as holiday cards and parties.

${access}

${signIn}
${appUrl ? (to ? signinUrl(appUrl, encodeURIComponent(to)) : appUrl) : ''}`;
  return { subject, html, text };
}

/** Tells the person who sent the invitation that a guest answered. */
export function buildRsvpNotice({ occasionName, householdName, answer, count, note, appUrl }) {
  const APP = 'Occasions Address Book';
  const word = { yes: 'Yes', maybe: 'Maybe', no: 'No' }[answer] ?? answer;
  const coming = answer !== 'no' && count ? ` (${count} ${count === 1 ? 'person' : 'people'})` : '';
  const subject = `RSVP from ${householdName}: ${word}${coming}`;
  const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
  const html = layout({
    heading: `${esc(householdName)} answered ${esc(word)}`,
    inner: p(`For <b>${esc(occasionName)}</b>: <b>${esc(word)}</b>${esc(coming)}.`)
      + (note ? p(`Their note: “${esc(note)}”`) : '')
      + (appUrl ? button(appUrl, `Open ${APP}`) : ''),
    footer: 'Every answer shows on the occasion in the app.',
  });
  const text = `${householdName} answered ${word}${coming} for ${occasionName}.${note ? `\n\nTheir note: "${note}"` : ''}\n\n${appUrl ?? ''}`;
  return { subject, html, text };
}
