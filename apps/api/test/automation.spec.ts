import {
  ConditionGroup,
  describeConditions,
  evaluateConditions,
  readField,
  renderTemplate,
} from '../../../packages/shared/src/automation';
import { DEFAULT_AUTOMATION_RULES } from '../src/modules/automation/default-rules';
import { ACTION_DEFINITIONS } from '../src/modules/automation/automation.service';
import { TRIGGERS_BY_KEY } from '../src/modules/automation/triggers';

const batch = {
  subjectType: 'BATCH',
  subjectId: 'b1',
  batchNumber: 'AMX-2026-001',
  productName: 'Amoxicillin 500 mg',
  daysToExpiry: 25,
  quantityOnHand: 500,
  valueAtRisk: 1250.5,
  batchStatus: 'RELEASED',
  isColdChain: false,
  isControlled: false,
  branchId: 'br1',
  nested: { deep: { value: 7 } },
};

describe('Field access', () => {
  it('reads a dotted path', () => {
    expect(readField(batch, 'nested.deep.value')).toBe(7);
  });

  it('returns undefined for a missing path rather than throwing', () => {
    expect(readField(batch, 'nope.not.here')).toBeUndefined();
    expect(readField(null, 'a.b')).toBeUndefined();
  });
});

describe('Condition evaluation (§58)', () => {
  const group = (conditions: unknown[], match: 'ALL' | 'ANY' = 'ALL'): ConditionGroup =>
    ({ match, conditions } as ConditionGroup);

  it('matches a numeric comparison', () => {
    expect(evaluateConditions(batch, group([{ field: 'daysToExpiry', operator: 'lte', value: 30 }])).matched).toBe(true);
    expect(evaluateConditions(batch, group([{ field: 'daysToExpiry', operator: 'gt', value: 30 }])).matched).toBe(false);
  });

  it('compares numbers numerically, not as text', () => {
    // "9" > "10" as text; the whole point is that it must not be.
    const subject = { value: 10 };
    expect(evaluateConditions(subject, group([{ field: 'value', operator: 'gt', value: 9 }])).matched).toBe(true);
    expect(evaluateConditions(subject, group([{ field: 'value', operator: 'lt', value: 9 }])).matched).toBe(false);
  });

  it('compares a numeric string as a number', () => {
    // Prisma Decimals arrive as objects that stringify to "12.50".
    const subject = { price: { toString: () => '12.50' } };
    expect(evaluateConditions(subject, group([{ field: 'price', operator: 'gt', value: 12 }])).matched).toBe(true);
    expect(evaluateConditions(subject, group([{ field: 'price', operator: 'lt', value: 12 }])).matched).toBe(false);
  });

  it('requires every condition under ALL', () => {
    const result = evaluateConditions(
      batch,
      group([
        { field: 'daysToExpiry', operator: 'lte', value: 30 },
        { field: 'batchStatus', operator: 'eq', value: 'QUARANTINED' },
      ]),
    );
    expect(result.matched).toBe(false);
    expect(result.detail.filter((d) => d.matched)).toHaveLength(1);
  });

  it('requires only one condition under ANY', () => {
    expect(
      evaluateConditions(
        batch,
        group(
          [
            { field: 'daysToExpiry', operator: 'gt', value: 999 },
            { field: 'batchStatus', operator: 'eq', value: 'RELEASED' },
          ],
          'ANY',
        ),
      ).matched,
    ).toBe(true);
  });

  it('handles in and not_in', () => {
    expect(evaluateConditions(batch, group([{ field: 'batchStatus', operator: 'in', value: ['AVAILABLE', 'RELEASED'] }])).matched).toBe(true);
    expect(evaluateConditions(batch, group([{ field: 'batchStatus', operator: 'not_in', value: ['AVAILABLE', 'RELEASED'] }])).matched).toBe(false);
  });

  it('handles between inclusively', () => {
    expect(evaluateConditions(batch, group([{ field: 'daysToExpiry', operator: 'between', value: 20, value2: 30 }])).matched).toBe(true);
    expect(evaluateConditions(batch, group([{ field: 'daysToExpiry', operator: 'between', value: 25, value2: 25 }])).matched).toBe(true);
    expect(evaluateConditions(batch, group([{ field: 'daysToExpiry', operator: 'between', value: 30, value2: 60 }])).matched).toBe(false);
  });

  it('handles booleans', () => {
    expect(evaluateConditions(batch, group([{ field: 'isControlled', operator: 'eq', value: false }])).matched).toBe(true);
    expect(evaluateConditions(batch, group([{ field: 'isControlled', operator: 'eq', value: true }])).matched).toBe(false);
  });

  it('treats a missing field as not matching, rather than as truthy', () => {
    // A rule referring to a field the subject does not carry must be quiet, not
    // fire on everything.
    expect(evaluateConditions(batch, group([{ field: 'missing', operator: 'gt', value: 0 }])).matched).toBe(false);
    expect(evaluateConditions(batch, group([{ field: 'missing', operator: 'eq', value: 'x' }])).matched).toBe(false);
    expect(evaluateConditions(batch, group([{ field: 'missing', operator: 'ne', value: 'x' }])).matched).toBe(false);
  });

  it('distinguishes a null value from a missing one only through is_null', () => {
    expect(evaluateConditions({ a: null }, group([{ field: 'a', operator: 'is_null' }])).matched).toBe(true);
    expect(evaluateConditions(batch, group([{ field: 'batchStatus', operator: 'is_not_null' }])).matched).toBe(true);
  });

  it('matches everything when no condition is given', () => {
    expect(evaluateConditions(batch, group([])).matched).toBe(true);
  });

  it('reports how each condition evaluated, so a rule can be explained', () => {
    const result = evaluateConditions(batch, group([{ field: 'daysToExpiry', operator: 'lte', value: 30 }]));
    expect(result.detail[0]).toMatchObject({
      field: 'daysToExpiry',
      operator: 'lte',
      expected: 30,
      actual: 25,
      matched: true,
    });
  });

  it('compares dates by instant', () => {
    const subject = { when: new Date('2026-06-01T00:00:00Z') };
    expect(
      evaluateConditions(subject, group([{ field: 'when', operator: 'lt', value: new Date('2026-07-01T00:00:00Z') }])).matched,
    ).toBe(true);
  });
});

describe('Message templates', () => {
  it('substitutes fields', () => {
    expect(renderTemplate('{productName} expires in {daysToExpiry} days', batch)).toBe(
      'Amoxicillin 500 mg expires in 25 days',
    );
  });

  it('reads a dotted path', () => {
    expect(renderTemplate('value {nested.deep.value}', batch)).toBe('value 7');
  });

  it('leaves an unknown placeholder visible instead of writing "undefined"', () => {
    // A broken template should be obvious in the notification, not silently
    // produce nonsense a pharmacist has to interpret.
    expect(renderTemplate('hello {nope}', batch)).toBe('hello {nope}');
  });
});

describe('Rule descriptions', () => {
  it('reads as a sentence', () => {
    expect(
      describeConditions({
        match: 'ALL',
        conditions: [{ field: 'daysToExpiry', operator: 'lte', value: 30 }],
      } as ConditionGroup),
    ).toBe('daysToExpiry is at most 30');
  });

  it('joins ANY conditions with OR', () => {
    const text = describeConditions({
      match: 'ANY',
      conditions: [
        { field: 'a', operator: 'gt', value: 1 },
        { field: 'b', operator: 'lt', value: 2 },
      ],
    } as ConditionGroup);
    expect(text).toContain(' OR ');
  });
});

describe('The shipped rules (§58 examples)', () => {
  it('has a unique code for every rule', () => {
    const codes = DEFAULT_AUTOMATION_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('names a real trigger', () => {
    for (const rule of DEFAULT_AUTOMATION_RULES) {
      expect(TRIGGERS_BY_KEY.has(rule.triggerType)).toBe(true);
    }
  });

  it('only tests fields the trigger actually produces', () => {
    for (const rule of DEFAULT_AUTOMATION_RULES) {
      const fields = new Set(TRIGGERS_BY_KEY.get(rule.triggerType)!.fields.map((f) => f.path));
      for (const condition of rule.conditions.conditions ?? []) {
        expect({ rule: rule.code, field: condition.field, known: fields.has(condition.field) }).toEqual({
          rule: rule.code,
          field: condition.field,
          known: true,
        });
      }
    }
  });

  it('only uses actions that exist', () => {
    const types = new Set(ACTION_DEFINITIONS.map((a) => a.type));
    for (const rule of DEFAULT_AUTOMATION_RULES) {
      for (const action of rule.actions) expect(types.has(action.type as never)).toBe(true);
      for (const step of rule.escalations) {
        for (const action of step.actions) expect(types.has(action.type as never)).toBe(true);
      }
    }
  });

  it('orders escalation steps by increasing delay', () => {
    for (const rule of DEFAULT_AUTOMATION_RULES) {
      let previous = 0;
      for (const step of rule.escalations) {
        expect(step.afterHours).toBeGreaterThan(previous);
        previous = step.afterHours;
      }
    }
  });

  it('covers every example the specification gives', () => {
    const codes = new Set(DEFAULT_AUTOMATION_RULES.map((r) => r.code));
    // stock below reorder point, expiry at 90 and 30 days, sustained
    // temperature excursion, overdue purchase order, stock variance needing
    // approval, and any controlled-drug variance.
    for (const code of [
      'LOW_STOCK',
      'EXPIRY_90',
      'EXPIRY_30',
      'COLD_CHAIN_EXCURSION',
      'PO_OVERDUE',
      'COUNT_VARIANCE',
      'CONTROLLED_VARIANCE',
    ]) {
      expect(codes.has(code)).toBe(true);
    }
  });

  it('never gives a rule an action that commits money or destroys stock', () => {
    // §12 and §29: ordering, disposal, approval and price changes stay human
    // decisions. An automation engine that could take them would be the most
    // dangerous component in the system.
    const forbidden = ['PLACE_ORDER', 'DISPOSE', 'APPROVE', 'DELETE', 'CHANGE_PRICE', 'PAY'];
    const available = ACTION_DEFINITIONS.map((a) => a.type);
    for (const type of forbidden) expect(available).not.toContain(type);
  });

  it('escalates the two rules that must not be forgotten about', () => {
    // A cold-chain excursion with no QA disposition, and a controlled variance,
    // both need chasing rather than one notification into a busy inbox.
    for (const code of ['COLD_CHAIN_EXCURSION', 'CONTROLLED_VARIANCE']) {
      const rule = DEFAULT_AUTOMATION_RULES.find((r) => r.code === code)!;
      expect(rule.escalations.length).toBeGreaterThan(0);
    }
  });
});
