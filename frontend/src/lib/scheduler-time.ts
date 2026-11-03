type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, timezone: string): ZonedParts {
  let formatter = dateTimeFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dateTimeFormatterCache.set(timezone, formatter);
  }

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function sameMinute(left: ZonedParts, right: ZonedParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

function parseLocalDateTime(date: string, time: string): ZonedParts {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) throw new Error('Enter a date and time.');

  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };
  const check = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute),
  );
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day ||
    parts.hour > 23 ||
    parts.minute > 59
  ) {
    throw new Error('Enter a valid date and time.');
  }
  return parts;
}

export function zonedDateTimeToIso(
  date: string,
  time: string,
  timezone: string,
): string {
  const target = parseLocalDateTime(date, time);
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
  );

  // Iteratively apply the IANA zone offset. The backend receives an absolute
  // RFC3339 instant while the selected zone is stored separately as metadata.
  let candidate = targetAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(new Date(candidate), timezone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = targetAsUtc - observedAsUtc;
    if (correction === 0) break;
    candidate += correction;
  }

  const resolved = new Date(candidate);
  if (!sameMinute(zonedParts(resolved, timezone), target)) {
    throw new Error('That local time does not exist in the selected timezone.');
  }
  return resolved.toISOString();
}

export function dateTimeInTimezone(instant: Date, timezone: string): {
  date: string;
  time: string;
} {
  const parts = zonedParts(instant, timezone);
  return {
    date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}

export function calendarDateKey(instant: Date, timezone: string): string {
  const { date } = dateTimeInTimezone(instant, timezone);
  return date;
}

export function formatInTimezone(instant: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function currentDateInTimezone(timezone: string): string {
  return dateTimeInTimezone(new Date(), timezone).date;
}

export function dateTimeInputForInstant(instant: string, timezone: string): {
  date: string;
  time: string;
} {
  return dateTimeInTimezone(new Date(instant), timezone);
}
