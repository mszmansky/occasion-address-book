// Calendar invitations (.ics, iCalendar) for emailed invitations: attached to the email as a calendar
// invite (mail apps show Accept / Maybe / Decline, and the reply goes to the organizer, the person
// who sent it) and offered as an "Add to calendar" download.

/** "7:00 PM", "7pm", "7:30 p.m.", "19:00", "noon" → { h, m }; null when there's no time in it. */
export function parseTime(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^noon\b/.test(s)) return { h: 12, m: 0 };
  if (/^midnight\b/.test(s)) return { h: 0, m: 0 };
  const m = /(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (min > 59 || h > 23 || (ap && (h < 1 || h > 12))) return null;
  if (!m[2] && !ap) return null; // a bare number isn't a time
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return { h, m: min };
}

// How far a time zone is ahead of UTC at a moment, in ms.
function zoneOffset(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** A wall-clock date and time in a time zone, as a UTC Date. */
export function zonedToUtc(ymd, { h, m }, timeZone = 'America/New_York') {
  const [y, mo, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  let tz = timeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'America/New_York'; }
  const first = guess - zoneOffset(guess, tz);
  return new Date(guess - zoneOffset(first, tz)); // again, in case the first guess crossed a clock change
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymdCompact = (ymd) => ymd.replace(/-/g, '');
const nextDay = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };
// iCalendar text: escape \ ; , and line breaks.
const text = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// A parameter value (CN="…"): no quotes or line breaks allowed inside.
const param = (s) => `"${String(s ?? '').replace(/["\r\n]/g, '').trim()}"`;

// Lines longer than 75 bytes are folded: continued on the next line after a space.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** The event's start and end: timed (3 hours) when the time can be read, else all day. Null without a date. */
export function eventTimes(occasion, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occasion?.date ?? '')) return null;
  const t = parseTime(occasion.time);
  if (!t) return { allDay: true, start: occasion.date, end: nextDay(occasion.date) };
  const start = zonedToUtc(occasion.date, t, timeZone);
  return { allDay: false, start, end: new Date(start.getTime() + 3 * 3600_000) };
}

/**
 * The invitation as an iCalendar file (METHOD:REQUEST), or '' when the occasion has no date.
 * organizer: { name, email } (replies from calendar apps go here); attendees: [{ name, email }].
 */
export function buildIcs({ occasion, uid, organizer, attendees = [], timeZone, description = '', url = '', now = new Date() }) {
  const when = eventTimes(occasion, timeZone);
  if (!when) return '';
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Occasions Address Book//Invitations//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(now)}`,
    when.allDay ? `DTSTART;VALUE=DATE:${ymdCompact(when.start)}` : `DTSTART:${stamp(when.start)}`,
    when.allDay ? `DTEND;VALUE=DATE:${ymdCompact(when.end)}` : `DTEND:${stamp(when.end)}`,
    `SUMMARY:${text(occasion.name)}`,
    occasion.location ? `LOCATION:${text(occasion.location)}` : '',
    description ? `DESCRIPTION:${text(description)}` : '',
    url ? `URL:${url}` : '',
    organizer?.email ? `ORGANIZER;CN=${param(organizer.name || organizer.email)}:mailto:${organizer.email}` : '',
    ...attendees.filter((a) => a.email).map((a) => `ATTENDEE;CN=${param(a.name || a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`),
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
