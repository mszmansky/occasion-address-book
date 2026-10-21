# Occasions Address Book

A small serverless web app that:
- keeps people and mailing addresses;
- tags them for occasions such as Christmas cards, a party or a graduation;
- prints **Avery 5160/8160 labels** or **A7 envelopes**;
- emails **invitations**;
- emails people a private link to **confirm or update their address**.

Data lives in Amazon DynamoDB, email goes through Amazon SES, and sign-in uses Amazon Cognito (accounts by invitation). The architecture is the same as the Vehicle Maintenance Tracker.

## What it does

- **Address book of households.** Each household is one envelope. Its edit screen has tabs (**Greetings**, **Address**, **People**, **Groups & Notes**); Save keeps the changes on every tab. It holds:
  - a name for the envelope ("The Smith Family");
  - an optional formal name ("Mr. and Mrs. John Smith") and email greeting ("John and Mary");
  - a mailing address;
  - the people in it (name, email, phone), one of them ticked as the **default contact**;
  - a shared email and phone;
  - groups (Family, Neighbors, Work…) and notes.

  Email and phone belong to each person; if people share an email, it goes on each of them (invitations and address checks still send one email per household). Households saved before this keep working: their old shared email and home phone move onto the people the next time you open and save them.

  You can search, and narrow the list with **Filter** (the funnel button): several groups (in *any* or *all* of them), cities, states, ZIP prefix, has/no email, has/missing mailing address, and address updates to review. Each active filter shows as a chip you can remove; **Clear all** resets. The same Filter is on each occasion's list, so e.g. *everyone in Michigan in the Christmas group* can be added with **Add all shown to the list**.
- **Import / export CSV.** Bring in a list from Excel, Numbers or Google Sheets. Columns are guessed from the headers ("First Name", "Spouse", "Zip Code"…) and can be changed before importing. The app's own export imports back unchanged; its People column keeps each person's email, e.g. `John Smith <john@x.com>; Mary Smith`.
- **Occasions.** Create one ("Christmas cards 2026"), tick who it's for and track who's been mailed. You can tick households one at a time, or everyone shown after a search or group filter. A new occasion can start from an earlier one's list, so next year's cards begin with this year's list.
- **Trash.** Deleting a household or occasion moves it to the Trash (account menu) for 30 days. **Restore** brings a household back onto the occasion lists it was on, and an occasion back with its list (including who was mailed and invited); links between two items that are both in the bin come back with whichever is restored second. **Delete forever** and **Empty trash** are there too. After 30 days items are removed automatically (DynamoDB TTL on the item, and the app also hides and purges anything past 30 days since TTL can lag a day or two). Each address book, shared or not, has its own bin; View-only people can look but not restore.
- **Printing.** Makes a PDF in the browser (jsPDF):
  - Avery 5160 / 8160 address labels, 30 per sheet, with "start at label N" for a partly used sheet;
  - A7 envelopes (5¼ × 7¼ in), one per page, with your return address in the corner;
  - a sheet of return-address labels.

  Text shrinks (and long names wrap) to fit, so nothing runs off a label. Settings has printer alignment offsets and alignment test pages. After printing, one click marks those households as mailed.
- **Email invitations.** Each household gets one email, sent to its default contact (the person ticked as default, or else the first person with an email). Where a household has more than one address, the send dialog's **Send to** lets you pick someone else or **Both** / **Everyone**. It opens "Dear {greeting}," and continues with your message, date, time and location. Replies go to you. You can send yourself a test first, and each household shows whether its email was sent or failed.
- **Address checks.** Email a household a private link, valid for 30 days, to confirm or correct their address. Their reply comes back for you to review side by side and accept or discard. You also get an email when they answer. Links are stored only as hashes and expire through DynamoDB TTL.

## Architecture

```
Browser ── Cognito user pool (sign-in from the browser, no SDK: frontend/auth.js)
   │            └─ "custom message" Lambda: invitation / reset emails in the app's style, sent through SES
   │
   ├── CloudFront ── S3 (static site: frontend/)
   │
   ├── S3 (private: profile photos, through short-lived signed links)
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
| `backend/src/lib/files.mjs` | Profile photos in a private S3 bucket: signed upload/view links (shared with Vehicle Maintenance) |
| `frontend/print-core.js` | Label and envelope layout (unit tested) |
| `frontend/filter-core.js` | Household filters (groups, city, state, ZIP, email, address, review) (unit tested) |
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
  SK = TRASH#<household|occasion>#<id>  a deleted item and its occasion-list rows, removed by TTL after 30 days
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

Cognito emails a temporary password. Sign in with it and you're asked to choose your own. **Forgot password?** emails a 6-digit code.

**Settings** (account menu) has four tabs:
- **Profile:** a profile photo (cropped to a square, shown in a circle here and beside your name at the top), your name, the name invitations come from, and your sign-in email (changing it emails a 6-digit code to the new address).
- **Return address:** printed on envelopes and return-address labels.
- **Security:** change password, and two-step verification with an authenticator app.
- **Printer:** label and envelope alignment offsets, with alignment test pages.
- **Sharing:** share your address book and occasions with other people (see below).

### Sharing

Everyone has their own private address book (with its own occasions). You can share yours from **Settings > Sharing** by email, choosing **Can edit** or **View only** for each person (changeable later; **Stop sharing** removes them).

- Someone without an account gets a Cognito invitation with a temporary password; everyone gets an email saying the book was shared with them.
- The people you share with **keep their own address book**. Once a book is shared with them, a switcher appears at the top of the screen listing **My address book** and each book shared with them (e.g. *Mike Szmansky's · Can edit*). The open book drives both **Address book** and **Occasions**, and is remembered on each device. A person can have several books shared with them.
- **Can edit:** everything the owner can do in that book except change its sharing. **View only:** look up, search, export and print; no changes and no emails. The API enforces this, not just the screens.
- The return address belongs to each book, so everyone prints the same one from a shared book. Name, photo, password, two-step verification and printer alignment stay personal.
- Shares are tied to each person's account (their permanent Cognito id), not their email, so either person can change their sign-in email without re-sharing.
- **Settings > Sharing** always manages *your own* book, and also lists the books shared with you.

Stored as `USER#<owner> / SHARE#<member id>` (the owner's list) and `MEMBER#<member id> / BOOK#<owner id>` (the books shared with someone). The app names the open book in an `x-book` request header; the API checks it against these. Shares saved by earlier versions (`SHARED#<email>`, `MEMBER#<id> / BOOK`) move over automatically the next time that person signs in.

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
