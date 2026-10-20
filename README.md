# Occasion Address Book

A small serverless web app that:
- keeps people and mailing addresses;
- tags them for occasions such as Christmas cards, a party or a graduation;
- prints **Avery 5160/8160 labels** or **A7 envelopes**;
- emails **invitations**;
- emails people a private link to **confirm or update their address**.

Data lives in Amazon DynamoDB, email goes through Amazon SES, and sign-in uses Amazon Cognito (accounts by invitation). The architecture is the same as the Vehicle Maintenance Tracker.

## What it does

- **Address book of households.** Each household is one envelope. It holds:
  - a name for the envelope ("The Smith Family");
  - an optional formal name ("Mr. and Mrs. John Smith") and email greeting ("John and Mary");
  - a mailing address;
  - the people in it (name, email, phone, birthday);
  - a shared email and phone;
  - groups (Family, Neighbors, Work…) and notes.

  You can search and filter by group.
- **Import / export CSV.** Bring in a list from Excel, Numbers or Google Sheets. Columns are guessed from the headers ("First Name", "Spouse", "Zip Code"…) and can be changed before importing. The app's own export imports back unchanged.
- **Occasions.** Create one ("Christmas cards 2026"), tick who it's for and track who's been mailed. You can tick households one at a time, or everyone shown after a search or group filter. A new occasion can start from an earlier one's list, so next year's cards begin with this year's list.
- **Printing.** Makes a PDF in the browser (jsPDF):
  - Avery 5160 / 8160 address labels, 30 per sheet, with "start at label N" for a partly used sheet;
  - A7 envelopes (5¼ × 7¼ in), one per page, with your return address in the corner;
  - a sheet of return-address labels.

  Text shrinks (and long names wrap) to fit, so nothing runs off a label. Settings has printer alignment offsets and alignment test pages. After printing, one click marks those households as mailed.
- **Email invitations.** Each household gets one email addressed to all of its people. It opens "Dear {greeting}," and continues with your message, date, time and location. Replies go to you. You can send yourself a test first, and each household shows whether its email was sent or failed.
- **Address checks.** Email a household a private link, valid for 30 days, to confirm or correct their address. Their reply comes back for you to review side by side and accept or discard. You also get an email when they answer. Links are stored only as hashes and expire through DynamoDB TTL.

## Architecture

```
Browser ── Cognito user pool (sign-in from the browser, no SDK: frontend/auth.js)
   │            └─ "custom message" Lambda: invitation / reset emails in the app's style, sent through SES
   │
   ├── CloudFront ── S3 (static site: frontend/)
   │
   └── API Gateway HTTP API ── Lambda "api" ── DynamoDB (single table, TTL on link tokens)
                                   │  verifies Cognito ID tokens against the user pool's JWKS
                                   └─ SES (invitations, address checks, "they replied" notices)
```

`/public/address/{token}` is the only route that needs no sign-in. It backs `update.html`, the page a household opens from its emailed link. The token travels in the URL fragment (`#t=…`), so it never shows up in server logs.

| Path | Purpose |
|---|---|
| `template.yaml` | AWS SAM template: table, API, Lambda, S3 + CloudFront |
| `backend/src/lib/api.mjs` | REST API routes and validation |
| `backend/src/lib/email.mjs` | Invitation, address-check and reply emails |
| `backend/src/lib/auth.mjs`, `repo.mjs`, `mailer.mjs` | Cognito token check, DynamoDB access, SES (shared with Vehicle Maintenance) |
| `backend/src/handlers/cognito-message.mjs` | Cognito's invitation, password-reset and email-change emails |
| `frontend/auth.js` | Cognito sign-in from the browser (shared with Vehicle Maintenance) |
| `scripts/invite-user.sh` | Invite someone (Cognito emails a temporary password) |
| `frontend/print-core.js` | Label and envelope layout (unit tested) |
| `frontend/csv-core.js` | CSV parsing, column guessing, export (unit tested) |
| `frontend/app.js` | The single-page app (vanilla JS, no build step) |
| `frontend/update.html` | Public "confirm your address" page |
| `scripts/deploy.sh` | Test, build, deploy, publish site |

### Data model (single table)

```
PK = USER#<Cognito user id (sub)>
  SK = PROFILE                   name, return address, printer offsets
  SK = HH#<id>                   household
  SK = OCC#<id>                  occasion
  SK = TAG#<occasionId>#<hhId>   household on an occasion's list (mailedAt, invitedAt)
PK = TOKEN#<sha256(token)>, SK = TOKEN    address-check link, removed by TTL after 30 days
```

## Prerequisites

- AWS CLI v2 and AWS SAM CLI, signed in to your account.
- Node.js 22+.
- An SES identity (a verified domain or address) to send from. **While SES is in the sandbox, every recipient must be verified too.** Request production access in the SES console before emailing friends and family.

## Deploy

Deploy in the same region as your SES identity (default `us-east-2`).

```bash
SENDER_EMAIL=noreply@your-domain.com ./scripts/deploy.sh
```

The stack creates its own Cognito user pool, which is protected from deletion and kept if the stack is ever deleted. Cognito's invitation and password-reset emails go out through the same SES identity as the app's email. With `APP_DOMAIN` set, the sender defaults to `noreply@<APP_DOMAIN>`. `ALLOWED_EMAILS` can further limit who may use the API.

### Accounts

Sign-up is by invitation only. Invite yourself (and anyone else) after the first deploy:

```bash
./scripts/invite-user.sh you@example.com
```

Cognito emails a temporary password. Sign in with it and you're asked to choose your own. **Forgot password?** emails a 6-digit code. Settings has **Change password**.

### Custom domain

This works the same as Vehicle Maintenance. Request an ACM certificate in **us-east-1** for the domain (and `www.`), then run:

```bash
APP_DOMAIN=your-domain.com APP_ALT_DOMAIN=www.your-domain.com \
APP_CERT_ARN=arn:aws:acm:us-east-1:...:certificate/... ./scripts/deploy.sh
```

Point DNS at the `CloudFrontUrl` output; at Cloudflare that's a CNAME set to DNS only (grey cloud). Later deploys remember the domain. Don't add the domain to CloudFront by hand.

## Printing tips

- Print at **Actual size / 100%**, never "Fit to page".
- Labels: use Letter paper. Print one page on plain paper with **Draw outlines** on and hold it against a label sheet to the light. Adjust **Settings > Printer alignment** if needed.
- Envelopes: choose the **A7** paper size in the print dialog and feed envelopes the way your printer's tray diagram shows.

## Local development

```bash
cd backend && npm install && npm test
```

The tests cover:
- Cognito token checks (wrong pool, wrong app client, access tokens, expired tokens, unconfirmed email) and per-user isolation;
- Cognito's invitation and reset emails;
- validation and import;
- tagging and copying lists;
- invitations, including SES sandbox rejections;
- the full address-check link flow and its expiry;
- label and envelope geometry against real jsPDF;
- CSV round-trips.

To run the site against a deployed API, copy `frontend/config.example.js` to `frontend/config.js` and fill it in. Then serve `frontend/` on port 8080, which CORS already allows.

## Costs

Everything is pay-per-use: DynamoDB on-demand, Lambda, HTTP API, CloudFront, and SES at $0.10 per 1,000 emails. Personal use is typically well under $1 a month. The table is retained if the stack is deleted.
