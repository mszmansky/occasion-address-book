// Sign-in with Amazon Cognito, called directly from the browser (no SDK).
//
// Everything here uses Cognito's public JSON API at https://cognito-idp.<region>.amazonaws.com/ with
// the app client id (no secret); account calls authenticate with the user's access token.
// Tokens are kept in localStorage and refreshed with the refresh token before the ID token expires.

const STORE = 'oab.auth';

export function createAuth({ region, userPoolId, userPoolClientId }) {
  const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;
  const clientId = userPoolClientId;
  const listeners = new Set();
  let tokens = load();
  let pending = null; // { email, session } while a sign-in waits for a code or new password
  let refreshing = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
  }
  function save(t) {
    tokens = t;
    try { if (t) localStorage.setItem(STORE, JSON.stringify(t)); else localStorage.removeItem(STORE); } catch { /* private mode */ }
  }

  function decode(jwt) {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  }

  function sessionFrom(t) {
    if (!t) return null;
    const claims = decode(t.idToken);
    return { idToken: t.idToken, accessToken: t.accessToken, user: { sub: claims.sub, email: claims.email } };
  }

  function emit(event) {
    const s = sessionFrom(tokens);
    for (const cb of listeners) cb(event, s);
  }

  async function call(action, body) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${action}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const type = String(json.__type ?? '').split('#').pop();
      const err = new Error(friendly(type, json.message));
      err.code = type;
      throw err;
    }
    return json;
  }

  function friendly(type, message) {
    switch (type) {
      case 'NotAuthorizedException':
        if (/expired/i.test(message ?? '') && /temporary/i.test(message ?? '')) return 'Your temporary password has expired. Ask for a new invitation.';
        if (/Incorrect username or password/i.test(message ?? '')) return 'Incorrect email or password';
        if (/Refresh Token/i.test(message ?? '')) return 'Your session has expired. Please sign in again.';
        return message || 'Not allowed';
      case 'UserNotFoundException': return 'Incorrect email or password';
      case 'CodeMismatchException': return "That code isn't right. Check it and try again.";
      case 'ExpiredCodeException': return 'That code has expired. Ask for a new one.';
      case 'InvalidPasswordException': return message?.replace(/^Password does not conform to policy: /, '') || 'Choose a longer password (at least 8 characters)';
      case 'LimitExceededException':
      case 'TooManyRequestsException':
      case 'TooManyFailedAttemptsException': return 'Too many attempts. Wait a few minutes and try again.';
      case 'AliasExistsException': return 'Another account already uses that email address';
      case 'EnableSoftwareTokenMFAException': return "That code isn't right. Check the time on your phone and try again.";
      case 'PasswordResetRequiredException': return 'You need to reset your password. Use "Forgot password?".';
      case 'UserNotConfirmedException': return 'This account has not been confirmed yet';
      default: return message || 'Something went wrong. Please try again.';
    }
  }

  function signedIn(result) {
    save({
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken ?? tokens?.refreshToken,
      expiresAt: Date.now() + (result.ExpiresIn ?? 3600) * 1000,
    });
    pending = null;
  }

  // What happens next after a password or code: done, or another step.
  function next(res, email) {
    if (res.AuthenticationResult) {
      signedIn(res.AuthenticationResult);
      emit('SIGNED_IN');
      return { done: true };
    }
    pending = { email, session: res.Session, challenge: res.ChallengeName };
    if (res.ChallengeName === 'SOFTWARE_TOKEN_MFA') return { step: 'mfa' };
    if (res.ChallengeName === 'NEW_PASSWORD_REQUIRED') return { step: 'new_password' };
    throw new Error(`Unsupported sign-in step: ${res.ChallengeName}`);
  }

  async function refresh() {
    if (!tokens?.refreshToken) return null;
    refreshing ??= call('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: clientId, AuthParameters: { REFRESH_TOKEN: tokens.refreshToken } })
      .then((res) => { signedIn(res.AuthenticationResult); emit('TOKEN_REFRESHED'); })
      .catch((err) => { if (err.code === 'NotAuthorizedException') { save(null); emit('SIGNED_OUT'); } else throw err; })
      .finally(() => { refreshing = null; });
    await refreshing;
    return sessionFrom(tokens);
  }

  async function accessToken() {
    const s = await api.getSession();
    if (!s) throw new Error('Please sign in again');
    return s.accessToken;
  }

  // Signing in or out in another tab updates this one too.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE) return;
    const had = Boolean(tokens);
    tokens = load();
    if (had && !tokens) emit('SIGNED_OUT');
    else if (!had && tokens) emit('SIGNED_IN');
  });

  const api = {
    onChange(cb) {
      listeners.add(cb);
      setTimeout(() => cb('INITIAL_SESSION', sessionFrom(tokens)));
      return () => listeners.delete(cb);
    },

    /** The current session, refreshed if the ID token is about to expire; null when signed out. */
    async getSession() {
      if (!tokens) return null;
      if (tokens.expiresAt - Date.now() < 5 * 60 * 1000) return refresh();
      return sessionFrom(tokens);
    },

    /** Force fresh tokens, e.g. after the email address changes. */
    refresh,

    async signIn(email, password) {
      const res = await call('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: email, PASSWORD: password } });
      return next(res, email);
    },

    pendingEmail: () => pending?.email ?? '',

    async answerMfa(code) {
      if (!pending) throw new Error('Sign in again');
      const res = await call('RespondToAuthChallenge', {
        ClientId: clientId, ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: pending.session,
        ChallengeResponses: { USERNAME: pending.email, SOFTWARE_TOKEN_MFA_CODE: code },
      });
      return next(res, pending.email);
    },

    // First sign-in with an invitation's temporary password.
    async setNewPassword(password) {
      if (!pending) throw new Error('Sign in again');
      const res = await call('RespondToAuthChallenge', {
        ClientId: clientId, ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: pending.session,
        ChallengeResponses: { USERNAME: pending.email, NEW_PASSWORD: password },
      });
      return next(res, pending.email);
    },

    cancelSignIn() { pending = null; },

    async signOut() {
      const t = tokens;
      save(null);
      pending = null;
      emit('SIGNED_OUT');
      if (t?.refreshToken) await call('RevokeToken', { ClientId: clientId, Token: t.refreshToken }).catch(() => {});
    },

    forgotPassword: (email) => call('ForgotPassword', { ClientId: clientId, Username: email }),
    confirmForgotPassword: (email, code, password) => call('ConfirmForgotPassword', { ClientId: clientId, Username: email, ConfirmationCode: code, Password: password }),

    changePassword: async (previous, proposed) => call('ChangePassword', { AccessToken: await accessToken(), PreviousPassword: previous, ProposedPassword: proposed }),

    // Email change: Cognito emails a code to the new address; the old one stays until it's confirmed.
    startEmailChange: async (email) => call('UpdateUserAttributes', { AccessToken: await accessToken(), UserAttributes: [{ Name: 'email', Value: email }] }),
    confirmEmailChange: async (code) => {
      await call('VerifyUserAttribute', { AccessToken: await accessToken(), AttributeName: 'email', Code: code });
      await refresh(); // new ID token with the new email
    },

    /** { email, mfaEnabled } */
    async getAccount() {
      const res = await call('GetUser', { AccessToken: await accessToken() });
      return {
        email: res.UserAttributes?.find((a) => a.Name === 'email')?.Value,
        mfaEnabled: (res.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA'),
      };
    },

    // Two-step verification with an authenticator app.
    async startMfaSetup(email) {
      const { SecretCode } = await call('AssociateSoftwareToken', { AccessToken: await accessToken() });
      const issuer = 'Occasion Address Book';
      const uri = `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${SecretCode}&issuer=${encodeURIComponent(issuer)}`;
      return { secret: SecretCode, uri };
    },
    async finishMfaSetup(code) {
      const res = await call('VerifySoftwareToken', { AccessToken: await accessToken(), UserCode: code, FriendlyDeviceName: 'Authenticator app' });
      if (res.Status !== 'SUCCESS') throw new Error("That code isn't right. Try again.");
      await call('SetUserMFAPreference', { AccessToken: await accessToken(), SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true } });
    },
    async disableMfa() {
      await call('SetUserMFAPreference', { AccessToken: await accessToken(), SoftwareTokenMfaSettings: { Enabled: false, PreferredMfa: false } });
    },

  };
  return api;
}
