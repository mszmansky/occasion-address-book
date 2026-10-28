import test from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/handlers/cognito-message.mjs';

const event = (triggerSource) => ({
  triggerSource,
  request: { codeParameter: '{####}', usernameParameter: '{username}' },
  response: {},
});

test('Cognito emails are built in the app style and keep the placeholders Cognito requires', async () => {
  process.env.APP_URL = 'https://cards.example.com';
  const invite = (await handler(event('CustomMessage_AdminCreateUser'))).response;
  assert.match(invite.emailSubject, /invited to Occasions Address Book/);
  assert.ok(invite.emailMessage.includes('{####}') && invite.emailMessage.includes('{username}'));
  assert.ok(invite.emailMessage.includes('https://cards.example.com'));
  for (const t of ['CustomMessage_ForgotPassword', 'CustomMessage_UpdateUserAttribute', 'CustomMessage_VerifyUserAttribute', 'CustomMessage_ResendCode']) {
    const r = (await handler(event(t))).response;
    assert.ok(r.emailMessage.includes('{####}'), t);
    assert.ok(r.emailSubject, t);
    assert.ok(r.emailMessage.length < 20000, t); // Cognito's limit for a custom message
  }
});

test('after a Forgot-password reset, the post-confirmation trigger only acts on that event', async () => {
  const { handler } = await import('../src/handlers/cognito-post-confirmation.mjs');
  const ev = { triggerSource: 'PostConfirmation_ConfirmSignUp', request: { userAttributes: { email: 'a@example.com' } }, response: {} };
  assert.equal(await handler(ev), ev); // sign-up confirmations: nothing sent
});

test('the password-changed notice', async () => {
  const { buildPasswordChanged } = await import('../src/lib/email.mjs');
  const m = buildPasswordChanged({ email: 'mike@example.com', when: new Date('2026-12-25T15:00:00Z'), timeZone: 'America/Los_Angeles', appUrl: 'https://x.example' });
  assert.match(m.text, /Friday, December 25, 2026 at 7:00 AM PST/);
  assert.match(m.html, /Forgot password\?/);
  assert.match(buildPasswordChanged({ email: 'a@b.c', when: new Date('2026-12-25T15:00:00Z'), timeZone: 'Not/AZone' }).text, /December 25, 2026/);
});

test('the invitation and share emails link straight to Sign in with the email filled in', async () => {
  const { buildCognitoMessage, buildShareNotice } = await import('../src/lib/email.mjs');
  const invite = buildCognitoMessage('CustomMessage_AdminCreateUser', { appUrl: 'https://cards.example.com/', codeParameter: '{####}', usernameParameter: '{username}' });
  assert.match(invite.html, /href="https:\/\/cards\.example\.com\/#signin=\{username\}"/);
  const share = buildShareNotice({ ownerName: 'Mike', ownerEmail: 'mike@example.com', role: 'edit', invited: true, appUrl: 'https://cards.example.com', to: 'kim+1@example.com' });
  assert.match(share.html, /href="https:\/\/cards\.example\.com\/#signin=kim%2B1%40example\.com"/);
  assert.match(share.text, /#signin=kim%2B1%40example\.com/);
});
