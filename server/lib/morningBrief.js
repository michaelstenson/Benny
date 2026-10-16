// The morning brief as finished Discord text, built from the digest.
// It used to be written by agent Benny (Sonnet) from GET /api/digest,
// which cost a full agent run every morning just to reword JSON. Now the
// app writes it here and Hermes's 7:00 job posts it verbatim, with no
// model call. The rules are the ones the agent followed: bills not on
// autopay that are due today or tomorrow can't be missed, weather comes
// first after that, empty sections are left out, and nothing is added
// that the digest didn't provide.

import { HOUSEHOLD_TIMEZONE } from './recurringBills.js';

const NAMES = { michael: 'Michael', mer: 'Mer' };

// A long overdue list would bury everything else (and Discord caps a
// message at 2,000 characters), so the brief shows this many and points
// to the app for the rest.
const MAX_TODOS = 8;

export function formatMorningBrief({ date, weather, events = [], todos = [], bills_due: bills = [] }) {
  const lines = [`🐧 **Good morning, Penguin Palace!** ${longDate(date)}`];

  const urgent = bills.filter((bill) => !bill.autopay && bill.days_until <= 1);
  const otherBills = bills.filter((bill) => !urgent.includes(bill));
  for (const bill of urgent) {
    lines.push(`🚨 **${clean(bill.name)}${amount(bill)} is due ${dueWhen(bill)}, and it's not on autopay.**`);
  }

  if (weather) lines.push(weatherLine(weather));

  if (events.length) {
    lines.push('', '📅 **Today**');
    for (const event of events) {
      lines.push(`• ${eventTime(event)}: ${clean(event.title)} (${name(event.owner)})`);
    }
  }

  if (todos.length) {
    const overdueFirst = [...todos.filter((t) => t.overdue), ...todos.filter((t) => !t.overdue)];
    lines.push('', '✅ **To-dos**');
    for (const todo of overdueFirst.slice(0, MAX_TODOS)) {
      // Chores is the usual list, so only another list's name is worth saying.
      const details = [
        todo.list && todo.list !== 'chores' ? clean(todo.list_name || todo.list) : null,
        todo.assignee ? name(todo.assignee) : null,
        todo.overdue ? `overdue since ${shortDate(todo.due_date)}` : null,
      ].filter(Boolean);
      lines.push(`• ${clean(todo.title)}${details.length ? ` (${details.join(', ')})` : ''}`);
    }
    if (overdueFirst.length > MAX_TODOS) {
      lines.push(`• …and ${overdueFirst.length - MAX_TODOS} more in Benny`);
    }
  }

  if (otherBills.length) {
    lines.push('', '💸 **Bills this week**');
    for (const bill of otherBills) {
      const how = bill.autopay ? 'autopay' : 'pay it yourself';
      lines.push(`• ${clean(bill.name)}${amount(bill)}, due ${dueWhen(bill)} (${how})`);
    }
  }

  if (!events.length && !todos.length && !bills.length) {
    lines.push('', 'Nothing on either calendar, no to-dos due and no bills this week. Enjoy the quiet.');
  }

  return lines.join('\n');
}

function weatherLine({ summary, high_f, low_f, precip_chance }) {
  let line = `${weatherEmoji(summary)} ${summary}, high ${high_f}° / low ${low_f}°`;
  if (precip_chance >= 50) line += `, ${precip_chance}% chance of precipitation. Bring an umbrella ☔`;
  return line;
}

function weatherEmoji(summary = '') {
  const s = summary.toLowerCase();
  if (s.includes('thunder')) return '⛈️';
  if (s.includes('snow')) return '❄️';
  if (s.includes('rain') || s.includes('drizzle')) return '🌧️';
  if (s.includes('fog')) return '🌫️';
  if (s.includes('overcast')) return '☁️';
  if (s.includes('partly')) return '⛅';
  if (s.includes('mostly clear')) return '🌤️';
  return '☀️';
}

function eventTime(event) {
  if (event.allDay) return 'All day';
  return new Date(event.start)
    .toLocaleTimeString('en-US', { timeZone: HOUSEHOLD_TIMEZONE, hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .replace(' AM', 'am')
    .replace(' PM', 'pm');
}

function name(person) {
  return NAMES[person] || clean(person || 'someone');
}

function amount(bill) {
  if (bill.amount == null) return '';
  const value = Number(bill.amount);
  const cents = Number.isInteger(value) ? 0 : 2;
  return ` ($${value.toLocaleString('en-US', { minimumFractionDigits: cents, maximumFractionDigits: cents })})`;
}

function dueWhen(bill) {
  if (bill.days_until === 0) return 'today';
  if (bill.days_until === 1) return 'tomorrow';
  return longDate(bill.next_due_date, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Dates in the digest are plain YYYY-MM-DD strings for Chicago's day, so
// they're formatted as UTC to keep them from shifting.
function longDate(day, options = { weekday: 'long', month: 'short', day: 'numeric' }) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
}

function shortDate(day) {
  return longDate(day, { month: 'short', day: 'numeric' });
}

// To-do titles and calendar events can contain anything: an invite from
// a stranger lands on the calendar on its own. Before they're posted to
// Discord, this keeps them on one line, makes Markdown and masked links
// show as plain text, and breaks @everyone / <@id> mentions so a title
// can't ping the server.
function clean(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\*_~`|[\]<]/g, '\\$&')
    .replace(/@/g, '@​');
}
