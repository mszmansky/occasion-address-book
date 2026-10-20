import { buildCognitoMessage } from '../lib/email.mjs';

// Cognito "custom message" trigger: replaces the plain default emails with ones in the app's style.
export const handler = async (event) => {
  const m = buildCognitoMessage(event.triggerSource, {
    appUrl: process.env.APP_URL,
    codeParameter: event.request?.codeParameter ?? '{####}',
    usernameParameter: event.request?.usernameParameter ?? '{username}',
  });
  event.response.emailSubject = m.subject;
  event.response.emailMessage = m.html;
  return event;
};
