import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

// Cognito "post authentication" trigger: after every successful sign-in, notes when, for the Admin
// screen's Last sign-in column (ACCOUNT#<sub> / LOGIN). It never blocks a sign-in.
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  const sub = event.request?.userAttributes?.sub;
  if (!sub || !process.env.TABLE_NAME) return event;
  try {
    await doc.send(new PutCommand({ TableName: process.env.TABLE_NAME, Item: { PK: `ACCOUNT#${sub}`, SK: 'LOGIN', at: new Date().toISOString() } }));
  } catch (e) {
    console.error('Recording the sign-in failed', e);
  }
  return event;
};
