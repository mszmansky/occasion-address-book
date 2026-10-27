#!/usr/bin/env bash
# Makes someone an admin: they get the Admin screen (in the menu under their name), where they manage
# everyone's accounts. They need to sign out and back in once afterwards.
#
#   ./scripts/make-admin.sh someone@example.com
#   ./scripts/make-admin.sh someone@example.com --remove     takes it away again
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="${1:?Usage: ./scripts/make-admin.sh someone@example.com [--remove]}"
REGION="${AWS_REGION:-us-east-2}"
STACK="${STACK_NAME:-occasion-address-book}"
POOL="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

if ! aws cognito-idp admin-get-user --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" >/dev/null 2>&1; then
  echo "$EMAIL doesn't have an account. Invite them first: ./scripts/invite-user.sh $EMAIL" >&2
  exit 1
fi

if [ "${2:-}" = "--remove" ]; then
  aws cognito-idp admin-remove-user-from-group --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" --group-name admin
  echo "$EMAIL is no longer an admin (takes effect when they next sign in)."
else
  aws cognito-idp admin-add-user-to-group --region "$REGION" --user-pool-id "$POOL" --username "$EMAIL" --group-name admin
  echo "$EMAIL is now an admin. Sign out of the app and back in to see Admin in the menu."
fi
