import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, zonedToUtc, buildIcs, eventTimes } from '../src/lib/ics.mjs';
import { buildRawEmail } from '../src/lib/mailer.mjs';

test('reads the time people type', () => {
  for (const [t, want] of [['7:00 PM', [19, 0]], ['7pm', [19, 0]], ['7:30 p.m.', [19, 30]], ['19:00', [19, 0]], ['noon', [12, 0]], ['12 AM', [0, 0]], ['12:15pm', [12, 15]], ['6:30 PM – 10 PM', [18, 30]]]) {
    const r = parseTime(t);
    assert.deepEqual(r && [r.h, r.m], want, t);
  }
  for (const t of ['', 'evening', '7', '25:00', '13pm']) assert.equal(parseTime(t), null, t);
});

test('local times become UTC, across daylight time', () => {
  assert.equal(zonedToUtc('2026-12-19', { h: 19, m: 0 }, 'America/Detroit').toISOString(), '2026-12-20T00:00:00.000Z'); // EST
  assert.equal(zonedToUtc('2026-07-04', { h: 19, m: 0 }, 'America/Detroit').toISOString(), '2026-07-04T23:00:00.000Z'); // EDT
  assert.equal(zonedToUtc('2026-07-04', { h: 19, m: 0 }, 'Not/AZone').toISOString(), '2026-07-04T23:00:00.000Z'); // falls back to New York
});

test('the calendar invitation: 3 hours, or all day without a time; none without a date', () => {
  const occasion = { name: 'Holiday Party, at last; finally', date: '2026-12-19', time: '7:00 PM', location: '14 Cherry Lane\nTroy' };
  const ics = buildIcs({ occasion, uid: 'o1-h1@x', organizer: { name: 'Mike "M" Szmansky', email: 'mike@example.com' }, attendees: [{ name: 'Kim', email: 'kim@example.com' }], timeZone: 'America/Detroit', description: 'RSVP: https://x/rsvp.html#t=abc', url: 'https://x/rsvp.html#t=abc', now: new Date('2026-11-01T12:00:00Z') });
  for (const line of ['METHOD:REQUEST', 'UID:o1-h1@x', 'DTSTAMP:20261101T120000Z', 'DTSTART:20261220T000000Z', 'DTEND:20261220T030000Z',
    'SUMMARY:Holiday Party\\, at last\\; finally', 'LOCATION:14 Cherry Lane\\nTroy', 'ORGANIZER;CN="Mike M Szmansky":mailto:mike@example.com',
    'ATTENDEE;CN="Kim";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:kim@example.com']) assert.ok(ics.replace(/\r\n /g, '').split('\r\n').includes(line), line);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded at 75 bytes');
  const allDay = buildIcs({ occasion: { ...occasion, time: 'evening' }, uid: 'u', organizer: { email: 'm@x.com' } });
  assert.match(allDay, /DTSTART;VALUE=DATE:20261219\r\nDTEND;VALUE=DATE:20261220/);
  assert.equal(buildIcs({ occasion: { name: 'x' }, uid: 'u' }), '');
  assert.equal(eventTimes({ date: '2026-12-31', time: '' }).end, '2027-01-01');
});

test('an email with a calendar invite is one MIME message: text, HTML and the invite, plus invite.ics', () => {
  const raw = buildRawEmail({ from: '"Mikë" <noreply@x.com>', to: ['a@b.com'], replyTo: 'm@x.com', subject: 'You’re invited', html: '<p>Hi</p>', text: 'Hi', calendar: 'BEGIN:VCALENDAR\r\n', boundary: 'B' });
  assert.match(raw, /^From: =\?UTF-8\?B\?TWlrw6s=\?= <noreply@x\.com>\r\nTo: a@b\.com\r\nReply-To: m@x\.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="Ba"/);
  assert.match(raw, /Content-Type: text\/calendar; charset=UTF-8; method=REQUEST/);
  assert.match(raw, /Content-Disposition: attachment; filename="invite.ics"/);
  assert.match(raw, /--Bm--/);
});
