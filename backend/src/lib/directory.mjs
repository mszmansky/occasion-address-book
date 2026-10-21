// Accounts in the Cognito user pool: check whether someone has one, and invite them (Cognito emails
// a temporary password; they choose their own at first sign-in). Sign-up is invite-only.

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

    /** { invited: true } for a new invitation or a re-sent one; { invited: false, exists: true } if they already have an account. */
    async invite(email) {
      const cl = await c();
      const existing = await getUser(email);
      if (existing) {
        if (existing.UserStatus !== 'FORCE_CHANGE_PASSWORD') return { invited: false, exists: true };
        await cl.send(new sdk.AdminCreateUserCommand({ UserPoolId: userPoolId, Username: email, MessageAction: 'RESEND', DesiredDeliveryMediums: ['EMAIL'] }));
        return { invited: true, resent: true };
      }
      await cl.send(new sdk.AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: email,
        UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }],
        DesiredDeliveryMediums: ['EMAIL'],
      }));
      return { invited: true };
    },
  };
}
