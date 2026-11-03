import { BadRequestException } from "@nestjs/common";

export interface AnalyticsPeriod {
  fromDate: string;
  toDate: string;
  timezone: string;
  start: Date;
  endExclusive: Date;
  numberOfDays: number;
}

export function resolveAnalyticsPeriod(
  fromDate: string,
  toDate: string,
  timezone: string,
): AnalyticsPeriod {
  validateCalendarDate(fromDate);
  validateCalendarDate(toDate);
  if (!isValidTimezone(timezone))
    throw new BadRequestException("timezone must be a valid IANA timezone");
  const numberOfDays = daysBetween(fromDate, toDate) + 1;
  if (numberOfDays < 1 || numberOfDays > 366)
    throw new BadRequestException(
      "Analytics periods must cover between 1 and 366 local calendar days",
    );
  return {
    fromDate,
    toDate,
    timezone,
    start: zonedMidnightUtc(fromDate, timezone),
    endExclusive: zonedMidnightUtc(addCalendarDays(toDate, 1), timezone),
    numberOfDays,
  };
}

export function zonedDateKey(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const item = Object.fromEntries(
    parts.map(({ type, value: part }) => [type, part]),
  );
  return `${item.year}-${item.month}-${item.day}`;
}

export function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function validateCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(
      "fromDate and toDate must be real calendar dates",
    );
  }
}

function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function daysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.floor(
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000,
  );
}

function zonedMidnightUtc(localDate: string, timezone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const desiredUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, Number(value)]),
    );
    const representedUtc = Date.UTC(
      values.year,
      values.month - 1,
      values.day,
      values.hour,
      values.minute,
      values.second,
    );
    const correction = desiredUtc - representedUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}
