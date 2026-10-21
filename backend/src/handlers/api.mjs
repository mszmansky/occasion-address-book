import { createApi } from '../lib/api.mjs';
import { createCognitoVerifier } from '../lib/auth.mjs';
import { createCognitoDirectory } from '../lib/directory.mjs';
import { createS3Files } from '../lib/files.mjs';
import { createSesMailer } from '../lib/mailer.mjs';
import { createDynamoRepo } from '../lib/repo.mjs';

const env = process.env;

export const handler = createApi({
  repo: createDynamoRepo({ tableName: env.TABLE_NAME }),
  verify: createCognitoVerifier({
    region: env.AWS_REGION, userPoolId: env.COGNITO_USER_POOL_ID, clientId: env.COGNITO_CLIENT_ID, allowedEmails: env.ALLOWED_EMAILS,
  }),
  mailer: createSesMailer({ from: env.SENDER_EMAIL, configurationSet: env.SES_CONFIGURATION_SET }),
  appUrl: env.APP_URL,
  directory: createCognitoDirectory({ userPoolId: env.COGNITO_USER_POOL_ID }),
  files: env.FILES_BUCKET ? createS3Files({ bucket: env.FILES_BUCKET }) : undefined,
});
