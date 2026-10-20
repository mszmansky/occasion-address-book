// Verifies Cognito-issued ID tokens (RS256, published as JWKS by the user pool).

import { createRemoteJWKSet, jwtVerify } from 'jose';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

export const cognitoIssuer = (region, userPoolId) => `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;

/**
 * @param {object} opts
 * @param {string} opts.region
 * @param {string} opts.userPoolId
 * @param {string} opts.clientId        the web app client; ID tokens carry it as the audience
 * @param {string} [opts.allowedEmails] comma-separated allow list; empty or "*" allows any account
 */
export function createCognitoVerifier({ region, userPoolId, clientId, allowedEmails = '', jwks } = {}) {
  const issuer = cognitoIssuer(region, userPoolId);
  const keySet = jwks ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  const allow = allowedEmails.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e && e !== '*');

  return async function verify(authorizationHeader) {
    const token = /^Bearer\s+(.+)$/i.exec(authorizationHeader ?? '')?.[1];
    if (!token) throw new HttpError(401, 'Sign in required');
    let payload;
    try {
      ({ payload } = await jwtVerify(token, keySet, { issuer, audience: clientId }));
    } catch {
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    // Only ID tokens carry the email; access tokens are for Cognito's own account calls.
    if (payload.token_use !== 'id') throw new HttpError(401, 'Sign in required');
    const email = String(payload.email ?? '').toLowerCase();
    if (!payload.sub || !email) throw new HttpError(401, 'Token is missing user details');
    if (payload.email_verified !== true && payload.email_verified !== 'true') throw new HttpError(403, 'Confirm your email address first');
    if (allow.length && !allow.includes(email)) throw new HttpError(403, 'This account is not allowed to use this app');
    return { sub: payload.sub, email };
  };
}
