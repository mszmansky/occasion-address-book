#!/usr/bin/env bash
# Invites someone to the app: Cognito emails them a temporary password, and they choose their
# own password the first time they sign in.
#
#   ./scripts/invite-user.sh someone@example.com
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:?Usage: ./scripts/invite-user.sh someone@example.com}"
REGION="${AWS_REGION:-us-east-2}"
STACK="${STACK_NAME:-occasion-address-book}"
POOL="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

if aws cognito-idp admin-get-user --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" >/dev/null 2>&1; then
  echo "$EMAIL already has an account. Re-sending the invitation (works only if they haven't signed in yet)."
  aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" \
    --message-action RESEND >/dev/null
else
  aws cognito-idp admin-create-user --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true \
    --desired-delivery-mediums EMAIL >/dev/null
fi
echo "Invitation emailed to $EMAIL."
