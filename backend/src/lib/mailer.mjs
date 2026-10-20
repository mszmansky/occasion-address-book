// Sends email through Amazon SES (v2 API).

import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

// "Mike Szmansky" <noreply@example.com>; quotes and line breaks are stripped from the name.
export function fromHeader(address, name) {
  const clean = String(name ?? '').replace(/["\r\n<>]/g, '').trim();
  return clean ? `"${clean}" <${address}>` : address;
}

export function createSesMailer({ from, configurationSet, client } = {}) {
  const ses = client ?? new SESv2Client({});
  return {
    async send({ to, subject, html, text, fromName, replyTo }) {
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
