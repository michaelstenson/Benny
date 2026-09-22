// Low-level Gmail API calls, using the same googleapis SDK as
// googleClient.js/calendar.js. This is the code-level half of the
// "read + draft-only" decision: this file has no function that calls
// Gmail's send endpoint, only drafts.create. That's not just a comment —
// there is genuinely no path from Benny to sending an email on your
// behalf. A human always opens the draft in Gmail and sends it
// themselves. If a future feature ever needs real sending, that's a
// deliberate, separate decision, not something that falls out of
// functions already here.

import { google } from 'googleapis';

function gmailFor(oauth2Client) {
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Pulls Subject/From/Date headers and the short snippet Gmail already
// generates — NOT the full message body. There's no feature yet that
// needs full email content, and pulling only metadata is both faster and
// meaningfully less of the inbox to have passed through this app at all.
export async function fetchRecentMessages(oauth2Client, { maxResults = 10 } = {}) {
  const gmail = gmailFor(oauth2Client);
  const { data } = await gmail.users.messages.list({ userId: 'me', maxResults });
  const messages = data.messages || [];

  return Promise.all(
    messages.map(async ({ id }) => {
      const { data: message } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      });
      const headers = Object.fromEntries((message.payload?.headers || []).map((h) => [h.name, h.value]));
      return {
        id,
        subject: headers.Subject || '(no subject)',
        from: headers.From || null,
        date: headers.Date || null,
        snippet: message.snippet || null,
      };
    })
  );
}

// Gmail wants the raw RFC 822 message as base64url (not regular base64 —
// '+'/'/' swapped for '-'/'_', and padding stripped).
function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Creates a DRAFT — deliberately the only write operation this file
// exposes. Returns Gmail's own compose UI link so a caller can hand the
// person a direct "review this" link rather than making them go find it.
export async function createDraft(oauth2Client, { to, subject, body }) {
  const gmail = gmailFor(oauth2Client);
  const rfc822 = [`To: ${to}`, `Subject: ${subject}`, '', body].join('\r\n');

  const { data } = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: base64UrlEncode(rfc822) } },
  });
  return data; // { id, message: { id, threadId } }
}
