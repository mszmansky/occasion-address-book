import { createApi } from '../lib/api.mjs';
import { createCognitoVerifier } from '../lib/auth.mjs';
import { createCognitoDirectory } from '../lib/directory.mjs';
import { createS3Files } from '../lib/files.mjs';
import { createSesMailer } from '../lib/mailer.mjs';
import { createDynamoRepo } from '../lib/repo.mjs';
import { createAddressChecker, createUspsClient } from '../lib/usps.mjs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const env = process.env;
const repo = createDynamoRepo({ tableName: env.TABLE_NAME });

// USPS credentials live in an SSM SecureString parameter as {"clientId": "...", "clientSecret": "..."}.
// Read once per container; a missing parameter means address checks aren't set up (asked again after 5 minutes).
const ssm = new SSMClient({});
let creds = { value: undefined, at: 0 };
async function uspsCredentials() {
  if (!env.USPS_PARAMETER) return null;
  if (creds.value || Date.now() - creds.at < 5 * 60_000 && creds.at) return creds.value;
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: env.USPS_PARAMETER, WithDecryption: true }));
    const v = JSON.parse(res.Parameter?.Value ?? '{}');
    creds = { value: v.clientId && v.clientSecret ? { clientId: v.clientId, clientSecret: v.clientSecret } : null, at: Date.now() };
  } catch (e) {
    if (e.name !== 'ParameterNotFound') console.error('USPS credentials', e);
    creds = { value: null, at: Date.now() };
  }
  return creds.value;
}

export const handler = createApi({
  repo,
  addressChecker: createAddressChecker({ repo, usps: createUspsClient({ getCredentials: uspsCredentials }) }),
  verify: createCognitoVerifier({
    region: env.AWS_REGION, userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID, allowedEmails: env.ALLOWED_EMAILS,
  }),
  mailer: createSesMailer({ from: env.SENDER_EMAIL, configurationSet: env.SES_CONFIGURATION_SET }),
  appUrl: env.APP_URL,
  directory: createCognitoDirectory({ userPoolId: env.COGNITO_USER_POOL_ID }),
  files: env.FILES_BUCKET ? createS3Files({ bucket: env.FILES_BUCKET }) : undefined,
});
