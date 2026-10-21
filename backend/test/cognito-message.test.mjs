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
