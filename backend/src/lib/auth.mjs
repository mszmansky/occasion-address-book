// Verifies Supabase-issued access tokens (asymmetric signing keys, published as JWKS).

import { createRemoteJWKSet, jwtVerify } from 'jose';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.supabaseUrl    e.g. https://abcd.supabase.co
 * @param {string} [opts.allowedEmails] comma-separated allow list; empty or "*" allows any signed-in user
 */
export function createSupabaseVerifier({ supabaseUrl, allowedEmails = '', jwks } = {}) {
  const issuer = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const allow = allowedEmails.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e && e !== '*');

  return async function verify(authorizationHeader) {
    const token = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? '')?.[1];
    if (!token) throw new HttpError(401, 'Sign in required');
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, { issuer, audience: 'authenticated' }));
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    const email = String(payload.email ?? '').toLowerCase();
    if (!payload.sub || !email) throw new HttpError(401, 'Token is missing user details');
    if (allow.length && !allow.includes(email)) throw new HttpError(403, 'This account is not allowed to use this app');
    // aal2 = the session also passed two-step verification (authenticator code)
    return { sub: payload.sub, email, aal: payload.aal === 'aal2' ? 'aal2' : 'aal1' };
  };
}
