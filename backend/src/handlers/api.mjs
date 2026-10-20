import { createApi } from '../lib/api.mjs';
import { createSupabaseVerifier } from '../lib/auth.mjs';
import { createSesMailer } from '../lib/mailer.mjs';
import { createDynamoRepo } from '../lib/repo.mjs';

const env = process.env;

export const handler = createApi({
  repo: createDynamoRepo({ tableName: env.TABLE_NAME }),
  verify: createSupabaseVerifier({ supabaseUrl: env.SUPABASE_URL, allowedEmails: env.ALLOWED_EMAILS }),
  mailer: createSesMailer({ from: env.SENDER_EMAIL, configurationSet: env.SES_CONFIGURATION_SET }),
  appUrl: env.APP_URL,
});
