import {
  SERIAL_EVENT_TYPES,
  SERIAL_STATUSES,
  allowedEvents,
  checkTransition,
} from '../src/modules/serials/serial.state';

describe('Serial lifecycle state machine (§3: features 141-150)', () => {
  it('receives a pack into stock and lets it be dispensed', () => {
    expect(checkTransition('IN_STOCK', 'DISPENSED')).toEqual({
      ok: true,
      toStatus: 'DISPENSED',
    });
  });

  it('refuses to dispense a pack that is already with a patient', () => {
    const result = checkTransition('DISPENSED', 'DISPENSED');
    expect(result.ok).toBe(false);
    // The refusal has to say what IS possible, or the operator is stuck.
    expect(result.reason).toContain('RETURNED');
  });

  it('treats destruction as terminal', () => {
    for (const event of SERIAL_EVENT_TYPES) {
      const result = checkTransition('DESTROYED', event);
      if (event === 'CORRECTED') continue;
      expect(result.ok).toBe(false);
    }
  });

  it('lets a destroyed record be corrected, but only with an explicit target', () => {
    expect(checkTransition('DESTROYED', 'CORRECTED').ok).toBe(false);
    expect(checkTransition('DESTROYED', 'CORRECTED', 'IN_STOCK')).toEqual({
      ok: true,
      toStatus: 'IN_STOCK',
    });
  });

  it('refuses a correction to a status that does not exist', () => {
    const result = checkTransition('IN_STOCK', 'CORRECTED', 'MISPLACED');
    expect(result.ok).toBe(false);
  });

  it('routes a returned pack through a release decision rather than straight back to stock', () => {
    // Returning stock to the shelf without a QA decision is exactly how a
    // tampered pack re-enters the supply chain.
    expect(allowedEvents('RETURNED')).toContain('RELEASED');
    expect(checkTransition('RETURNED', 'RELEASED')).toEqual({ ok: true, toStatus: 'IN_STOCK' });
    expect(checkTransition('RETURNED', 'SOLD').ok).toBe(false);
  });

  it('lets a recall reach a pack in any live state', () => {
    for (const status of ['IN_STOCK', 'TRANSFERRED', 'DISPENSED', 'SOLD', 'RETURNED'] as const) {
      expect(checkTransition(status, 'RECALLED').ok).toBe(true);
    }
  });

  it('receives a transferred pack at the far end', () => {
    expect(checkTransition('TRANSFERRED', 'RECEIVED')).toEqual({ ok: true, toStatus: 'IN_STOCK' });
  });

  it('rejects an unknown starting status instead of guessing', () => {
    expect(checkTransition('SOMEWHERE', 'SOLD').ok).toBe(false);
    expect(allowedEvents('SOMEWHERE')).toEqual([]);
  });

  it('gives every status at least one way forward except the terminal one', () => {
    for (const status of SERIAL_STATUSES) {
      const events = allowedEvents(status).filter((e) => e !== 'CORRECTED');
      if (status === 'DESTROYED') expect(events).toEqual([]);
      else expect(events.length).toBeGreaterThan(0);
    }
  });
});
