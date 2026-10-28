// Sends email through Amazon SES (v2 API).

import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

// "Mike Szmansky" <noreply@example.com>; quotes and line breaks are stripped from the name.
export function fromHeader(address, name) {
  const clean = String(name ?? '').replace(/["\r\n<>]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
}

// Header text outside plain ASCII is written as =?UTF-8?B?…?= (RFC 2047).
const headerText = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

/**
 * A whole email as MIME, for an invitation with a calendar invite: text, HTML and the invite as
 * alternatives (mail apps that understand invites show Accept / Maybe / Decline), plus the same
 * invite as an invite.ics attachment.
 */
export function buildRawEmail({ from, to, replyTo, subject, html, text, calendar, boundary = `oab${Date.now().toString(36)}` }) {
  const alt = `${boundary}a`;
  const mixed = `${boundary}m`;
  const part = (type, body) => `Content-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(body)}\r\n`;
  const fromLine = from.replace(/^"([^"]*)"/, (m, name) => (/^[\x20-\x7e]*$/.test(name) ? m : headerText(name)));
  return [
    `From: ${fromLine}`,
    `To: ${(Array.isArray(to) ? to : [to]).join(', ')}`,
    replyTo ? `Reply-To: ${replyTo}` : '',
    `Subject: ${headerText(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    part('text/plain; charset=UTF-8', text),
    `--${alt}`,
    part('text/html; charset=UTF-8', html),
    `--${alt}`,
    part('text/calendar; charset=UTF-8; method=REQUEST', calendar),
    `--${alt}--`,
    '',
    `--${mixed}`,
    'Content-Disposition: attachment; filename="invite.ics"',
    part('application/ics; name="invite.ics"', calendar),
    `--${mixed}--`,
    '',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '' || i < 6).join('\r\n');
}

export function createSesMailer({ from, configurationSet, client } = {}) {
  const ses = client ?? new SESv2Client({});
  return {
    // calendar: an .ics invitation to include (sent as a whole MIME message).
    async send({ to, subject, html, text, fromName, replyTo, calendar }) {
      if (calendar) {
        await ses.send(new SendEmailCommand({
          FromEmailAddress: fromHeader(from, fromName),
          Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
          ConfigurationSetName: configurationSet || undefined,
          Content: { Raw: { Data: Buffer.from(buildRawEmail({ from: fromHeader(from, fromName), to, replyTo, subject, html, text, calendar }), 'utf8') } },
        }));
        return;
      }
      await ses.send(new SendEmailCommand({
        FromEmailAddress: fromHeader(from, fromName),
        Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
        ReplyToAddresses: replyTo ? [replyTo] : undefined,
        ConfigurationSetName: configurationSet || undefined,
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }));
    },
  };
}
