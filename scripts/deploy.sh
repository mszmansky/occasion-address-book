#!/usr/bin/env bash
# Builds and deploys the stack, then publishes the website.
#
#   ./scripts/deploy.sh
#
# Optional environment variables:
#   SENDER_EMAIL          SES-verified From address; remembered after the first deploy, else noreply@<APP_DOMAIN>
#   AWS_REGION            default: us-east-2 (use the region where your SES identity is verified)
#   AWS_PROFILE           AWS CLI profile to use
#   STACK_NAME            default: occasion-address-book
#   ALLOWED_EMAILS        comma-separated sign-in allow list, default * (anyone with an account)
#   SES_CONFIGURATION_SET optional SES configuration set
#   APP_DOMAIN            custom domain for the website, e.g. example-cards.com
#   APP_ALT_DOMAIN        optional second domain, e.g. www.example-cards.com
#   APP_CERT_ARN          ACM certificate (us-east-1) covering those domains
#                         These three are remembered: later deploys reuse the stack's current values.
set -euo pipefail

cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-us-east-2}"
STACK="${STACK_NAME:-occasion-address-book}"
ALLOWED_EMAILS="${ALLOWED_EMAILS:-*}"
SES_CONFIGURATION_SET="${SES_CONFIGURATION_SET:-}"

for cmd in sam aws node npm; do
  command -v "$cmd" >/dev/null || { echo "Missing required tool: $cmd" >&2; exit 1; }
done

echo "==> Installing dependencies and running tests"
(cd backend && npm ci --no-audit --no-fund --loglevel=error) || { echo "npm install failed (see the error above)" >&2; exit 1; }
(cd backend && npm test) > /tmp/occasion-address-book-tests.log 2>&1 || {
  cat /tmp/occasion-address-book-tests.log >&2
  echo "Tests failed" >&2
  exit 1
}

echo "==> Building"
sam build --cached

# Custom domain settings: reuse what the stack already has unless given, so a plain
# redeploy never drops the domain from CloudFront.
current_param() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text 2>/dev/null | grep -v '^None$' || true
}
APP_DOMAIN="${APP_DOMAIN-$(current_param AppDomain)}"
APP_ALT_DOMAIN="${APP_ALT_DOMAIN-$(current_param AppAltDomain)}"
APP_CERT_ARN="${APP_CERT_ARN-$(current_param AppCertificateArn)}"
if [ -n "$APP_DOMAIN" ] && [ -z "$APP_CERT_ARN" ]; then
  echo "APP_DOMAIN is set but APP_CERT_ARN isn't. Find the certificate with:" >&2
  echo "  aws acm list-certificates --region us-east-1 --query 'CertificateSummaryList[].[DomainName,CertificateArn]' --output table" >&2
  exit 1
fi

# The sender is remembered too: a plain redeploy keeps the address the stack already uses.
SENDER_EMAIL="${SENDER_EMAIL:-$(current_param SenderEmail)}"
SENDER_EMAIL="${SENDER_EMAIL:-${APP_DOMAIN:+noreply@$APP_DOMAIN}}"
if [ -z "$SENDER_EMAIL" ]; then
  echo "Set SENDER_EMAIL to an SES-verified address (or set APP_DOMAIN to send from noreply@<domain>)." >&2
  exit 1
fi

echo "==> Checking SES sender in $REGION"
ses_verified() {
  [ "$(aws sesv2 get-email-identity --region "$REGION" --email-identity "$1" \
    --query VerifiedForSendingStatus --output text 2>/dev/null)" = "True" ]
}
# Cognito sends its emails through the verified identity: the address itself, or its domain.
if ses_verified "$SENDER_EMAIL"; then SES_IDENTITY="$SENDER_EMAIL"
elif ses_verified "${SENDER_EMAIL#*@}"; then SES_IDENTITY="${SENDER_EMAIL#*@}"
else
  echo "SES can't send from $SENDER_EMAIL in $REGION." >&2
  echo "Verify that address (or its domain) in the SES console for $REGION, or set AWS_REGION to the region where it's verified." >&2
  exit 1
fi

PARAMS=(
  "SesIdentity=$SES_IDENTITY"
  "SenderEmail=$SENDER_EMAIL"
  "AllowedEmails=$ALLOWED_EMAILS"
)
# SAM rejects empty parameter values, so only pass optional ones when set.
if [ -n "$SES_CONFIGURATION_SET" ]; then PARAMS+=("SesConfigurationSet=$SES_CONFIGURATION_SET"); fi
if [ -n "$APP_DOMAIN" ]; then PARAMS+=("AppDomain=$APP_DOMAIN" "AppCertificateArn=$APP_CERT_ARN"); fi
if [ -n "$APP_ALT_DOMAIN" ]; then PARAMS+=("AppAltDomain=$APP_ALT_DOMAIN"); fi

echo "==> Deploying stack $STACK to $REGION"
sam deploy \
  --stack-name "$STACK" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides "${PARAMS[@]}"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
API_URL="$(output ApiUrl)"
APP_URL="$(output AppUrl)"
BUCKET="$(output WebBucketName)"
DIST_ID="$(output DistributionId)"

echo "==> Publishing website"
cat > frontend/config.js <<EOF
window.APP_CONFIG = {
  apiUrl: '${API_URL}',
  region: '${REGION}',
  userPoolId: '$(output UserPoolId)',
  userPoolClientId: '$(output UserPoolClientId)',
};
EOF
aws s3 sync frontend/ "s3://$BUCKET/" --region "$REGION" --delete \
  --exclude "config.example.js" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null

cat <<EOF

Done.
  Website:  $APP_URL
  API:      $API_URL

To invite someone (including yourself the first time):
  ./scripts/invite-user.sh someone@example.com
EOF
