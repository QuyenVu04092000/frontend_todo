import type { Routine } from "../services/routines";

/** Monday-first display order (JS getDay(): 0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [0, 6];

/** Local calendar date as "YYYY-MM-DD" (not UTC). */
export const toDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const fromDateKey = (key: string): Date => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (date: Date, amount: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

export const startOfToday = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

export const isScheduledOn = (routine: Routine, date: Date) =>
  routine.daysOfWeek.includes(date.getDay());

/**
 * First day the routine counts toward stats: the day it was created, or an
 * earlier day the user back-filled a check-in for. Days before this are
 * neither "missed" nor counted in rates.
 */
export const trackingStart = (routine: Routine): Date => {
  const created = new Date(routine.createdAt);
  let start = new Date(
    created.getFullYear(),
    created.getMonth(),
    created.getDate(),
  );
  for (const key of routine.completions) {
    const day = fromDateKey(key);
    if (day < start) start = day;
  }
  return start;
};

/** Number of history days we ask the API for. */
export const HISTORY_DAYS = 120;

/**
 * Consecutive scheduled days completed, counting back from today.
 * Today only breaks the streak once it's over, so an unchecked "today"
 * is skipped instead of resetting the streak to 0.
 */
export const currentStreak = (routine: Routine, today = startOfToday()) => {
  const done = new Set(routine.completions);
  const firstDay = trackingStart(routine);
  let streak = 0;

  for (let offset = 0; offset < HISTORY_DAYS; offset++) {
    const day = addDays(today, -offset);
    if (day < firstDay) break;
    if (!isScheduledOn(routine, day)) continue;
    if (done.has(toDateKey(day))) {
      streak++;
    } else if (offset === 0) {
      continue;
    } else {
      break;
    }
  }
  return streak;
};

export const bestStreak = (routine: Routine, today = startOfToday()) => {
  const done = new Set(routine.completions);
  let best = 0;
  let run = 0;
  for (let offset = HISTORY_DAYS - 1; offset >= 0; offset--) {
    const day = addDays(today, -offset);
    if (!isScheduledOn(routine, day)) continue;
    if (done.has(toDateKey(day))) {
      run++;
      best = Math.max(best, run);
    } else if (offset !== 0) {
      run = 0;
    }
  }
  return best;
};

/** Share of scheduled days completed over the last `days` days (incl. today). */
export const completionRate = (
  routine: Routine,
  days = 30,
  today = startOfToday(),
) => {
  const done = new Set(routine.completions);
  const firstDay = trackingStart(routine);
  let scheduled = 0;
  let completed = 0;
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(today, -offset);
    if (day < firstDay) break;
    if (!isScheduledOn(routine, day)) continue;
    const key = toDateKey(day);
    if (offset === 0 && !done.has(key)) continue; // today still open
    scheduled++;
    if (done.has(key)) completed++;
  }
  return scheduled ? Math.round((completed / scheduled) * 100) : null;
};

export const describeSchedule = (daysOfWeek: number[]): string => {
  const sorted = [...daysOfWeek].sort();
  const same = (a: number[]) =>
    a.length === sorted.length && a.every((d, i) => d === sorted[i]);
  if (same(ALL_DAYS)) return "Every day";
  if (same(WEEKDAYS)) return "Weekdays";
  if (same(WEEKENDS)) return "Weekends";
  return WEEK_ORDER.filter((d) => daysOfWeek.includes(d))
    .map((d) => DAY_SHORT[d])
    .join(", ");
};
