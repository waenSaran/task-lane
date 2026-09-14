export interface ScheduleSlotDefinition {
  slotKey: string;
  scheduledAt: Date;
}

export interface LatestDueScheduleSlotInput {
  now: Date;
  timezone: string;
  fetchTimes: readonly string[];
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalDateTimeParts extends LocalDateParts {
  hour: number;
  minute: number;
}

function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localParts(date: Date, timezone: string): LocalDateTimeParts {
  const parts = formatter(timezone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Unable to resolve ${type} in timezone ${timezone}`);
    return Number(value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function parseFetchTime(value: string): { hour: number; minute: number; normalized: string } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid fetch time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid fetch time: ${value}`);
  return { hour, minute, normalized: `${match[1]}:${match[2]}` };
}

function localDateKey(parts: LocalDateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function previousLocalDate(parts: LocalDateParts): LocalDateParts {
  const previous = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - 86_400_000);
  return {
    year: previous.getUTCFullYear(),
    month: previous.getUTCMonth() + 1,
    day: previous.getUTCDate(),
  };
}

function zonedLocalToUtc(
  date: LocalDateParts,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const desired = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0);
  let candidate = desired;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = localParts(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
      0,
    );
    const delta = desired - actualAsUtc;
    if (delta === 0) return new Date(candidate);
    candidate += delta;
  }

  const resolved = localParts(new Date(candidate), timezone);
  if (
    resolved.year !== date.year ||
    resolved.month !== date.month ||
    resolved.day !== date.day ||
    resolved.hour !== hour ||
    resolved.minute !== minute
  ) {
    throw new Error(`Unable to resolve local schedule time in timezone ${timezone}`);
  }
  return new Date(candidate);
}

function definition(
  date: LocalDateParts,
  fetchTime: ReturnType<typeof parseFetchTime>,
  timezone: string,
): ScheduleSlotDefinition {
  return {
    slotKey: `${localDateKey(date)}|${fetchTime.normalized}|${timezone}`,
    scheduledAt: zonedLocalToUtc(date, fetchTime.hour, fetchTime.minute, timezone),
  };
}

export function latestDueScheduleSlot(input: LatestDueScheduleSlotInput): ScheduleSlotDefinition {
  if (input.fetchTimes.length === 0) throw new Error("At least one fetch time is required");
  const fetchTimes = input.fetchTimes.map(parseFetchTime).sort((a, b) =>
    a.normalized.localeCompare(b.normalized),
  );
  const nowLocal = localParts(input.now, input.timezone);
  const today = { year: nowLocal.year, month: nowLocal.month, day: nowLocal.day };

  const todayDue = fetchTimes
    .map((fetchTime) => definition(today, fetchTime, input.timezone))
    .filter((slot) => slot.scheduledAt.getTime() <= input.now.getTime());

  if (todayDue.length > 0) return todayDue[todayDue.length - 1]!;

  return definition(previousLocalDate(today), fetchTimes[fetchTimes.length - 1]!, input.timezone);
}
