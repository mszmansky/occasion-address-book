import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildPasswordChanged } from '../lib/email.mjs';
import { createSesMailer } from '../lib/mailer.mjs';
import { userPk } from '../lib/repo.mjs';

// Cognito "post confirmation" trigger. After a Forgot-password reset it emails the
// "your password was changed" notice (a change made in Settings sends it through the API instead).
// A failure to send never blocks the reset.
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const mailer = createSesMailer({ from: process.env.SENDER_EMAIL, configurationSet: process.env.SES_CONFIGURATION_SET });

export const handler = async (event) => {
  if (event.triggerSource !== 'PostConfirmation_ConfirmForgotPassword') return event;
  const { email, sub } = event.request?.userAttributes ?? {};
  if (!email) return event;
  try {
    let timeZone;
    if (sub && process.env.TABLE_NAME) {
      const res = await doc.send(new GetCommand({ TableName: process.env.TABLE_NAME, Key: { PK: userPk(sub), SK: 'PROFILE' } }));
      timeZone = res.Item?.timeZone;
    }
    await mailer.send({ to: email, ...buildPasswordChanged({ email, timeZone, appUrl: process.env.APP_URL }) });
  } catch (e) {
    console.error('Password-changed notice failed', e);
  }
  return event;
};
