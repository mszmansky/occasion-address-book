// Accounts in the Cognito user pool: find someone by email, and invite them if they have no account
// (Cognito emails a temporary password; they choose their own at first sign-in). Sign-up is invite-only.
//
// Every account has a permanent id ("sub") that never changes, even when its email does; sharing is
// tied to that id, so people can change their email freely.

const attrOf = (attrs = [], name) => attrs.find((a) => a.Name === name)?.Value;
const subOf = (attrs = []) => attrOf(attrs, 'sub');

// What the Admin screen shows for each account. status: active (has signed in), invited (hasn't yet
// chosen a password), or Cognito's own status for anything rarer (RESET_REQUIRED and so on).
const accountOf = (u) => ({
  sub: subOf(u.Attributes ?? u.UserAttributes),
  username: u.Username,
  email: attrOf(u.Attributes ?? u.UserAttributes, 'email') ?? '',
  status: u.UserStatus === 'CONFIRMED' ? 'active' : u.UserStatus === 'FORCE_CHANGE_PASSWORD' ? 'invited' : String(u.UserStatus ?? '').toLowerCase(),
  enabled: u.Enabled !== false,
  createdAt: u.UserCreateDate ? new Date(u.UserCreateDate).toISOString() : undefined,
});

export function createCognitoDirectory({ userPoolId, client } = {}) {
  let sdk = null;
  async function c() {
    sdk ??= await import('@aws-sdk/client-cognito-identity-provider');
    client ??= new sdk.CognitoIdentityProviderClient({});
    return client;
  }

  async function getUser(email) {
    const cl = await c();
    try {
      return await cl.send(new sdk.AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
    } catch (err) {
      if (err.name === 'UserNotFoundException') return null;
      throw err;
    }
  }

  return {
    async exists(email) {
      return Boolean(await getUser(email));
    },

    /**
     * Makes sure the person has an account. Returns { sub, invited }: invited is true when Cognito
     * emailed them an invitation (new account, or a re-send if they never signed in).
     */
    async invite(email) {
      const cl = await c();
      const existing = await getUser(email);
      if (existing) {
        const sub = subOf(existing.UserAttributes);
        if (existing.UserStatus !== 'FORCE_CHANGE_PASSWORD') return { sub, invited: false, exists: true };
        await cl.send(new sdk.AdminCreateUserCommand({ UserPoolId: userPoolId, Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
        return { sub, invited: true, resent: true };
      }
      const res = await cl.send(new sdk.AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }],
        DesiredDeliveryMediums: ['EMAIL'],
      }));
      return { sub: subOf(res.User?.Attributes), invited: true };
    },

    // ---------- for admins ----------
    /** Every account in the pool. */
    async listUsers() {
      const cl = await c();
      const out = [];
      let PaginationToken;
      do {
        const res = await cl.send(new sdk.ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken }));
        out.push(...(res.Users ?? []).map(accountOf));
        PaginationToken = res.PaginationToken;
      } while (PaginationToken);
      return out;
    },

    /** The account ids (subs) in a group. */
    async groupMembers(group) {
      const cl = await c();
      const out = [];
      let NextToken;
      do {
        const res = await cl.send(new sdk.ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: group, Limit: 60, NextToken }));
        out.push(...(res.Users ?? []).map((u) => subOf(u.Attributes)));
        NextToken = res.NextToken;
      } while (NextToken);
      return out.filter(Boolean);
    },

    /** One account by its permanent id, or null. */
    async getBySub(sub) {
      const cl = await c();
      const res = await cl.send(new sdk.ListUsersCommand({ UserPoolId: userPoolId, Filter: `sub = "${String(sub).replace(/["\\]/g, '')}"`, Limit: 1 }));
      const u = res.Users?.[0];
      return u ? accountOf(u) : null;
    },

    /** Turns an account off (it can't sign in, and its sessions end) or back on. */
    async setEnabled(username, on) {
      const cl = await c();
      if (on) {
        await cl.send(new sdk.AdminEnableUserCommand({ UserPoolId: userPoolId, Username: username }));
        return;
      }
      await cl.send(new sdk.AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: username })).catch(() => {});
      await cl.send(new sdk.AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
    },

    async deleteUser(username) {
      const cl = await c();
      try {
        await cl.send(new sdk.AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
      } catch (err) {
        if (err.name !== 'UserNotFoundException') throw err;
      }
    },
  };
}
