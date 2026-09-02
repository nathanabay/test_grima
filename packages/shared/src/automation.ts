/**
 * Condition evaluation for the automation engine (§58).
 *
 * Pure and side-effect free, so the rules an administrator writes can be
 * exhaustively tested without a database. The engine gathers subjects, this
 * decides which of them match, and only then does anything happen.
 *
 * Deliberately not an expression language: a rule is a list of field/operator/
 * value comparisons. That is enough for every example in the specification, and
 * it cannot be turned into arbitrary code by whoever edits a rule.
 */

export const CONDITION_OPERATORS = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'is_null',
  'is_not_null',
  'between',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface RuleCondition {
  field: string;
  operator: ConditionOperator;
  value?: unknown;
  /** Upper bound for `between`. */
  value2?: unknown;
}

export interface ConditionGroup {
  /** How the conditions combine. Defaults to ALL. */
  match?: 'ALL' | 'ANY';
  conditions: RuleCondition[];
}

export interface ConditionResult {
  matched: boolean;
  /** Each condition and how it evaluated, so a rule can be explained. */
  detail: { field: string; operator: string; expected: unknown; actual: unknown; matched: boolean }[];
}

/** Read a dotted path from an object, returning undefined rather than throwing. */
export function readField(subject: unknown, path: string): unknown {
  if (subject === null || subject === undefined) return undefined;
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string, unknown>)[key];
  }, subject);
}

function toComparable(value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;

  // Prisma Decimals and numeric strings compare numerically; anything else
  // compares as text. Comparing "10" against "9" as text would say 10 < 9.
  if (typeof value === 'object' && typeof (value as { toString: () => string }).toString === 'function') {
    const asString = String(value);
    const asNumber = Number(asString);
    return Number.isFinite(asNumber) && asString.trim() !== '' ? asNumber : asString;
  }

  const asNumber = Number(value);
  return Number.isFinite(asNumber) && String(value).trim() !== '' ? asNumber : String(value);
}

function compare(actual: unknown, operator: ConditionOperator, expected: unknown, expected2?: unknown): boolean {
  switch (operator) {
    case 'is_null':
      return actual === null || actual === undefined;
    case 'is_not_null':
      return actual !== null && actual !== undefined;
    default:
      break;
  }

  // Every other operator needs a value to compare against; a missing one is
  // never a match rather than an accidental truthy comparison.
  if (actual === null || actual === undefined) return false;

  const a = toComparable(actual);
  const b = toComparable(expected);

  switch (operator) {
    case 'eq':
      return a === b;
    case 'ne':
      return a !== b;
    case 'lt':
      return typeof a === 'number' && typeof b === 'number' ? a < b : String(a) < String(b);
    case 'lte':
      return typeof a === 'number' && typeof b === 'number' ? a <= b : String(a) <= String(b);
    case 'gt':
      return typeof a === 'number' && typeof b === 'number' ? a > b : String(a) > String(b);
    case 'gte':
      return typeof a === 'number' && typeof b === 'number' ? a >= b : String(a) >= String(b);
    case 'in':
      return Array.isArray(expected) && expected.map(toComparable).includes(a);
    case 'not_in':
      return Array.isArray(expected) && !expected.map(toComparable).includes(a);
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case 'starts_with':
      return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
    case 'between': {
      const upper = toComparable(expected2);
      if (typeof a !== 'number' || typeof b !== 'number' || typeof upper !== 'number') return false;
      return a >= b && a <= upper;
    }
    default:
      return false;
  }
}

/** Evaluate a condition group against one subject. */
export function evaluateConditions(subject: unknown, group: ConditionGroup): ConditionResult {
  const conditions = group.conditions ?? [];

  // A rule with no conditions matches every subject its trigger produced. That
  // is a deliberate choice: "notify on every temperature excursion" needs no
  // condition, and forcing a dummy one would be worse.
  if (!conditions.length) return { matched: true, detail: [] };

  const detail = conditions.map((condition) => {
    const actual = readField(subject, condition.field);
    return {
      field: condition.field,
      operator: condition.operator,
      expected: condition.operator === 'between' ? [condition.value, condition.value2] : condition.value,
      actual: actual instanceof Date ? actual.toISOString() : actual,
      matched: compare(actual, condition.operator, condition.value, condition.value2),
    };
  });

  const matched =
    (group.match ?? 'ALL') === 'ANY'
      ? detail.some((d) => d.matched)
      : detail.every((d) => d.matched);

  return { matched, detail };
}

/**
 * Render a template against a subject: "Batch {batch.batchNumber} expires in
 * {daysToExpiry} days".
 *
 * An unknown placeholder is left visible rather than replaced with "undefined",
 * so a broken template is obvious in the notification instead of silently
 * producing nonsense.
 */
export function renderTemplate(template: string, subject: unknown): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (match, path: string) => {
    const value = readField(subject, path);
    if (value === null || value === undefined) return match;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  });
}

/** A human-readable form of a condition group, for the rule list. */
export function describeConditions(group: ConditionGroup): string {
  const conditions = group.conditions ?? [];
  if (!conditions.length) return 'every record the trigger produces';

  const words: Record<ConditionOperator, string> = {
    eq: 'is',
    ne: 'is not',
    lt: 'is less than',
    lte: 'is at most',
    gt: 'is more than',
    gte: 'is at least',
    in: 'is one of',
    not_in: 'is none of',
    contains: 'contains',
    starts_with: 'starts with',
    is_null: 'is not set',
    is_not_null: 'is set',
    between: 'is between',
  };

  return conditions
    .map((c) => {
      if (c.operator === 'is_null' || c.operator === 'is_not_null') {
        return `${c.field} ${words[c.operator]}`;
      }
      if (c.operator === 'between') {
        return `${c.field} ${words[c.operator]} ${String(c.value)} and ${String(c.value2)}`;
      }
      return `${c.field} ${words[c.operator]} ${
        Array.isArray(c.value) ? c.value.join(', ') : String(c.value)
      }`;
    })
    .join((group.match ?? 'ALL') === 'ANY' ? ' OR ' : ' AND ');
}
