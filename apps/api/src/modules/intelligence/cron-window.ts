/**
 * Does a cron expression fire in the hour that has just begun?
 *
 * Deliberately small: minute, hour, day-of-month, month and day-of-week, with
 * `*`, lists, ranges and step values. Delivery runs hourly, so the minute
 * field decides nothing here and is only validated - a report scheduled for
 * 08:30 is delivered in the 08:00 pass rather than not at all.
 */
export function cronMatchesHour(expression: string, at: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const matches = (field: string, value: number, min: number, max: number): boolean => {
    if (field === '*') return true;
    for (const part of field.split(',')) {
      const [range, stepText] = part.split('/');
      const step = stepText ? Number(stepText) : 1;
      if (!Number.isFinite(step) || step < 1) return false;

      let from = min;
      let to = max;
      if (range !== '*') {
        const [a, b] = range.split('-');
        from = Number(a);
        to = b === undefined ? from : Number(b);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      }
      if (value < from || value > to) continue;
      if ((value - from) % step === 0) return true;
    }
    return false;
  };

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  // The minute field is validated so a malformed expression is reported
  // rather than treated as "every hour".
  if (!matches(minute, 0, 0, 59) && !/^[\d*,\-/]+$/.test(minute)) return false;

  // Standard cron accepts both 0 and 7 for Sunday, and a range may use either
  // end ("1-7" is Monday to Sunday). Rewriting 7 to 0 in the field would turn
  // that range into the empty "1-0", so the DAY is offered in both forms and
  // the field is left exactly as it was written.
  const weekday = at.getDay();
  const weekdayMatches =
    matches(dayOfWeek, weekday, 0, 7) ||
    (weekday === 0 && matches(dayOfWeek, 7, 0, 7));

  return (
    matches(hour, at.getHours(), 0, 23) &&
    matches(dayOfMonth, at.getDate(), 1, 31) &&
    matches(month, at.getMonth() + 1, 1, 12) &&
    weekdayMatches
  );
}
