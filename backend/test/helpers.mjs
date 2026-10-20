// In-memory stand-ins for DynamoDB and SES, plus a signed-token helper.

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

export function createMemoryRepo() {
  const rows = new Map();
  const key = (pk, sk) => `${pk}\u0000${sk}`;
  const clone = (x) => (x ? structuredClone(x) : null);
  const sorted = (list) => list.sort((a, b) => a.SK.localeCompare(b.SK));
  return {
    rows,
    async get(pk, sk) { return clone(rows.get(key(pk, sk))); },
    async put(item) { rows.set(key(item.PK, item.SK), clone(item)); return item; },
    async del(pk, sk) { rows.delete(key(pk, sk)); },
    async query(pk, prefix = '') {
      return sorted([...rows.values()].filter((r) => r.PK === pk && r.SK.startsWith(prefix)).map(clone));
    },
    async batchDel(keys) { for (const k of keys) rows.delete(key(k.PK, k.SK)); },
    async batchPut(items) { for (const item of items) rows.set(key(item.PK, item.SK), clone(item)); },
  };
}

export function createFakeMailer({ failFor = [] } = {}) {
  const sent = [];
  return {
    sent,
    async send(msg) {
      const to = [].concat(msg.to);
      if (to.some((t) => failFor.includes(t))) {
        const e = new Error(`Email address is not verified. The following identities failed the check: ${to.join(', ')}`);
        e.name = 'MessageRejected';
        throw e;
      }
      sent.push(msg);
    },
  };
}

// Cognito-shaped ID tokens signed by a local key.
export const REGION = 'us-east-2';
export const USER_POOL_ID = 'us-east-2_TestPool';
export const CLIENT_ID = 'test-client-id';
export const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

export async function createTokenFactory() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims = {}, { issuer = ISSUER, audience = CLIENT_ID, expiresIn = '1h' } = {}) => new SignJWT({
    email: 'mike@example.com', email_verified: true, token_use: 'id', ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject(claims.sub ?? 'user-1')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
  return { jwks, sign };
}
