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

  return (
    matches(hour, at.getHours(), 0, 23) &&
    matches(dayOfMonth, at.getDate(), 1, 31) &&
    matches(month, at.getMonth() + 1, 1, 12) &&
    matches(dayOfWeek, at.getDay(), 0, 6)
  );
}
