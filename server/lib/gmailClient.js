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

// --- Search and read, for agent Benny only (see the routes in gmail.js) ---

// A long newsletter or a reply chain would fill Benny's context for
// nothing, so a body is cut off here, and the caller is told it was.
const MAX_BODY_CHARS = 8000;

function headerMap(payload) {
  return Object.fromEntries((payload?.headers || []).map((h) => [h.name.toLowerCase(), h.value]));
}

// Search one person's mailbox with Gmail's own query syntax (from:,
// subject:, newer_than:30d, ...). Metadata and Gmail's snippet only;
// reading a whole message is a separate, deliberate call.
export async function searchMessages(oauth2Client, { query, maxResults = 10 }) {
  const gmail = gmailFor(oauth2Client);
  const { data } = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });

  return Promise.all(
    (data.messages || []).map(async ({ id }) => {
      const { data: message } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'To', 'Date'],
      });
      const headers = headerMap(message.payload);
      return {
        id,
        from: headers.from || null,
        to: headers.to || null,
        subject: headers.subject || '(no subject)',
        date: headers.date || null,
        snippet: message.snippet || null,
        unread: (message.labelIds || []).includes('UNREAD'),
      };
    })
  );
}

// One message as plain text: the headers that matter, the body (the
// text/plain part when there is one, otherwise the HTML part flattened
// to text), and attachment names. Attachments themselves are never
// fetched.
export async function readMessage(oauth2Client, id) {
  const gmail = gmailFor(oauth2Client);
  const { data: message } = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const headers = headerMap(message.payload);

  const parts = flattenParts(message.payload);
  const plain = parts.find((p) => p.mimeType === 'text/plain' && !p.filename && p.body?.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && !p.filename && p.body?.data);
  let body = plain ? decodeBody(plain.body.data) : html ? htmlToText(decodeBody(html.body.data)) : '';
  body = body.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  const truncated = body.length > MAX_BODY_CHARS;
  return {
    id,
    from: headers.from || null,
    to: headers.to || null,
    cc: headers.cc || null,
    reply_to: headers['reply-to'] || null,
    subject: headers.subject || '(no subject)',
    date: headers.date || null,
    body: truncated ? `${body.slice(0, MAX_BODY_CHARS)}…` : body,
    truncated,
    attachments: parts.filter((p) => p.filename).map((p) => p.filename),
  };
}

function flattenParts(part) {
  if (!part) return [];
  return [part, ...(part.parts || []).flatMap(flattenParts)];
}

function decodeBody(data) {
  return Buffer.from(data, 'base64url').toString('utf8');
}

// Good enough for reading an email, not for rendering one: drops styles
// and scripts, turns block tags into line breaks, strips the rest, and
// decodes the common entities.
function htmlToText(html) {
  const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (match, name) => {
      if (name[0] === '#') {
        const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      return entities[name.toLowerCase()] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ');
}

// Gmail wants the raw RFC 822 message as base64url (not regular base64 —
// '+'/'/' swapped for '-'/'_', and padding stripped).
function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// RFC 2047: a header with anything beyond plain ASCII becomes one or more
// =?UTF-8?B?...?= words. Each word stays under the 75-character limit and
// never splits a character's bytes across two words.
export function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ');
}

// Creates a DRAFT — deliberately the only write operation this file
// exposes. Returns Gmail's own compose UI link so a caller can hand the
// person a direct "review this" link rather than making them go find it.
export async function createDraft(oauth2Client, { to, subject, body }) {
  const gmail = gmailFor(oauth2Client);
  // Without the charset header Gmail reads the bytes as Latin-1, and a
  // header has to be plain ASCII, so an en dash in a subject used to
  // arrive as "â€“". The body is declared UTF-8; the subject is encoded.
  const rfc822 = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');

  const { data } = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: base64UrlEncode(rfc822) } },
  });
  return data; // { id, message: { id, threadId } }
}
