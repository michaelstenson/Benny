// Shared by the Move page and the homepage's move card (Stage 22): how a
// task's dates read, whose list a task belongs on, and which of us is
// looking at this device.

window.MoveShared = (function () {
  const PEOPLE = {
    michael: { label: 'Michael', color: '#34D399' },
    mer: { label: 'Mer', color: '#A78BFA' },
  };
  const REPEAT_LABEL = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly' };

  function parts(date) {
    const [year, month, day] = date.split('-').map(Number);
    return { year, month, day, d: new Date(Date.UTC(year, month - 1, day)) };
  }

  function currentYear(today) {
    return Number(today.slice(0, 4));
  }

  function monthLabel(date, today) {
    const { year, d } = parts(date);
    const name = d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
    return year === currentYear(today) ? name : `${name} ${year}`;
  }

  function dayLabel(date, today) {
    const { year, d } = parts(date);
    const options = { month: 'short', day: 'numeric', timeZone: 'UTC' };
    if (year !== currentYear(today)) options.year = 'numeric';
    return d.toLocaleDateString(undefined, options);
  }

  function weekdayLabel(date, today) {
    const { d } = parts(date);
    return `${d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })} ${dayLabel(date, today)}`;
  }

  // "Nov", "Nov – Jan 2027", "Sep 10 – Sep 18, 2027", "Weekly · next Sun Dec 6".
  function whenLabel(task, today) {
    if (task.repeat && task.due_date) {
      const bits = [`${REPEAT_LABEL[task.repeat]} · next ${weekdayLabel(task.due_date, today)}`];
      if (task.repeat_until) bits.push(`until ${monthLabel(task.repeat_until, today)}`);
      if (task.times_done) bits.push(`done ${task.times_done}×`);
      return bits.join(' · ');
    }
    const { start_date: start, due_date: due } = task;
    if (!start && !due) return 'No date yet';
    if (task.date_precision === 'month') {
      const first = monthLabel(start || due, today);
      const last = due ? monthLabel(due, today) : first;
      return first === last ? first : `${first} – ${last}`;
    }
    if (!start || start === due) return `Due ${dayLabel(due || start, today)}`;
    if (!due) return `From ${dayLabel(start, today)}`;
    return `${dayLabel(start, today)} – ${dayLabel(due, today)}`;
  }

  function isOverdue(task, today) {
    return ['todo', 'doing', 'waiting'].includes(task.status) && task.due_date && task.due_date < today;
  }

  // A "both" task belongs on its lead's list; a "both" task with no lead
  // yet is on both lists.
  function belongsTo(task, person) {
    if (person === 'all') return true;
    if (task.owner === person) return true;
    return task.owner === 'both' && (!task.lead || task.lead === person);
  }

  function personDots(task) {
    const dot = (id) =>
      `<span class="hl-dot hl-dot-sm" style="background:${PEOPLE[id].color};box-shadow:0 0 6px ${PEOPLE[id].color};"></span>`;
    if (task.owner !== 'both') return dot(task.owner);
    return task.lead ? dot(task.lead) : dot('michael') + dot('mer');
  }

  function whoLabel(task) {
    if (task.owner !== 'both') return PEOPLE[task.owner].label;
    return task.lead ? `Both · ${PEOPLE[task.lead].label} leads` : 'Both';
  }

  // Which of us is using this device, for the "mine" view. Per device on
  // purpose (no setup, and a phone belongs to one of us). Storage can be
  // unavailable (private mode), so every access is guarded.
  const STORAGE_KEY = 'benny.person';
  function getPerson() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'michael' || value === 'mer' ? value : 'all';
    } catch {
      return 'all';
    }
  }
  function setPerson(person) {
    try {
      localStorage.setItem(STORAGE_KEY, person);
    } catch {
      // Not remembered; the toggle still works for this visit.
    }
  }

  function daysLeftLabel(days) {
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 0) return `${-days} day${days === -1 ? '' : 's'} ago`;
    return `${days} days`;
  }

  return {
    PEOPLE, whenLabel, dayLabel, monthLabel, isOverdue, belongsTo,
    personDots, whoLabel, getPerson, setPerson, daysLeftLabel,
  };
})();
