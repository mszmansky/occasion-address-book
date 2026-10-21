// Accounts in the Cognito user pool: find someone by email, and invite them if they have no account
// (Cognito emails a temporary password; they choose their own at first sign-in). Sign-up is invite-only.
//
// Every account has a permanent id ("sub") that never changes, even when its email does; sharing is
// tied to that id, so people can change their email freely.

const subOf = (attrs = []) => attrs.find((a) => a.Name === 'sub')?.Value;

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
  };
}
