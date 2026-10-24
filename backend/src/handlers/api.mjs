import { createApi } from '../lib/api.mjs';
import { createCognitoVerifier } from '../lib/auth.mjs';
import { createCognitoDirectory } from '../lib/directory.mjs';
import { createS3Files } from '../lib/files.mjs';
import { createSesMailer } from '../lib/mailer.mjs';
import { createDynamoRepo } from '../lib/repo.mjs';
import { createAddressChecker, createGoogleClient } from '../lib/address-check.mjs';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const env = process.env;
const repo = createDynamoRepo({ tableName: env.TABLE_NAME });

// The Google API key for address checks lives in an SSM SecureString parameter (just the key).
// Read once per container; a missing parameter means address checks aren't set up (asked again after 5 minutes).
const ssm = new SSMClient({});
let apiKey = { value: undefined, at: 0 };
async function googleApiKey() {
  if (!env.ADDRESS_CHECK_PARAMETER) return null;
  if (apiKey.value || Date.now() - apiKey.at < 5 * 60_000 && apiKey.at) return apiKey.value;
  try {
    const res = await ssm.send(new GetParameterCommand({ Name: env.ADDRESS_CHECK_PARAMETER, WithDecryption: true }));
    const raw = String(res.Parameter?.Value ?? '').trim();
    const v = raw.startsWith('{') ? JSON.parse(raw).apiKey : raw;
    apiKey = { value: v || null, at: Date.now() };
  } catch (e) {
    if (e.name !== 'ParameterNotFound') console.error('Address check API key', e);
    apiKey = { value: null, at: Date.now() };
  }
  return apiKey.value;
}

export const handler = createApi({
  repo,
  addressChecker: createAddressChecker({ repo, client: createGoogleClient({ getApiKey: googleApiKey }) }),
  verify: createCognitoVerifier({
    region: env.AWS_REGION, userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID, allowedEmails: env.ALLOWED_EMAILS,
  }),
  mailer: createSesMailer({ from: env.SENDER_EMAIL, configurationSet: env.SES_CONFIGURATION_SET }),
  appUrl: env.APP_URL,
  directory: createCognitoDirectory({ userPoolId: env.COGNITO_USER_POOL_ID }),
  files: env.FILES_BUCKET ? createS3Files({ bucket: env.FILES_BUCKET }) : undefined,
  media: env.MEDIA_BUCKET ? createS3Files({ bucket: env.MEDIA_BUCKET }) : undefined,
});
