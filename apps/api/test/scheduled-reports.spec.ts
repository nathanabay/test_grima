import { cronMatchesHour } from '../src/modules/intelligence/cron-window';

/** 2026-09-02 is a Wednesday. */
const at = (iso: string) => new Date(iso);

describe('Scheduled report delivery window (§40)', () => {
  it('fires an hourly schedule in every pass', () => {
    expect(cronMatchesHour('0 * * * *', at('2026-09-02T03:00:00'))).toBe(true);
    expect(cronMatchesHour('0 * * * *', at('2026-09-02T23:00:00'))).toBe(true);
  });

  it('fires a daily schedule only in its own hour', () => {
    expect(cronMatchesHour('30 8 * * *', at('2026-09-02T08:00:00'))).toBe(true);
    expect(cronMatchesHour('30 8 * * *', at('2026-09-02T09:00:00'))).toBe(false);
  });

  it('delivers an 08:30 report in the 08:00 pass rather than not at all', () => {
    // Delivery runs hourly, so the minute cannot decide anything; dropping the
    // report because 30 !== 0 would mean it silently never arrives.
    expect(cronMatchesHour('30 8 * * *', at('2026-09-02T08:00:00'))).toBe(true);
  });

  it('honours a day-of-week restriction', () => {
    // Weekdays only: Wednesday matches, Sunday does not.
    expect(cronMatchesHour('0 7 * * 1-5', at('2026-09-02T07:00:00'))).toBe(true);
    expect(cronMatchesHour('0 7 * * 1-5', at('2026-09-06T07:00:00'))).toBe(false);
  });

  it('honours a day-of-month restriction', () => {
    expect(cronMatchesHour('0 6 1 * *', at('2026-09-01T06:00:00'))).toBe(true);
    expect(cronMatchesHour('0 6 1 * *', at('2026-09-02T06:00:00'))).toBe(false);
  });

  it('handles step values and lists', () => {
    expect(cronMatchesHour('0 */6 * * *', at('2026-09-02T12:00:00'))).toBe(true);
    expect(cronMatchesHour('0 */6 * * *', at('2026-09-02T13:00:00'))).toBe(false);
    expect(cronMatchesHour('0 8,17 * * *', at('2026-09-02T17:00:00'))).toBe(true);
    expect(cronMatchesHour('0 8,17 * * *', at('2026-09-02T16:00:00'))).toBe(false);
  });

  it('refuses a malformed expression rather than treating it as "always"', () => {
    // A report that runs every hour because its schedule was mistyped is worse
    // than one that does not run: it mails everyone hourly.
    expect(cronMatchesHour('every hour', at('2026-09-02T08:00:00'))).toBe(false);
    expect(cronMatchesHour('0 8 * *', at('2026-09-02T08:00:00'))).toBe(false);
    expect(cronMatchesHour('', at('2026-09-02T08:00:00'))).toBe(false);
    expect(cronMatchesHour('0 25 * * *', at('2026-09-02T08:00:00'))).toBe(false);
  });
});
