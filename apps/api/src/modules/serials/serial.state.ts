/**
 * The serial lifecycle state machine (§3: features 141-150).
 *
 * A serialised pack is a physical object: it can only be in one place, and it
 * can only get to the next place along a route that actually exists. Encoding
 * that as data rather than as scattered `if` statements is what makes the
 * history defensible - a regulator asking "how did this pack reach a patient"
 * gets an answer that no code path could have skipped.
 */

export const SERIAL_STATUSES = [
  'IN_STOCK',
  'DISPENSED',
  'SOLD',
  'TRANSFERRED',
  'RETURNED',
  'RECALLED',
  'DESTROYED',
] as const;

export type SerialStatus = (typeof SERIAL_STATUSES)[number];

export const SERIAL_EVENT_TYPES = [
  'RECEIVED',
  'DISPENSED',
  'SOLD',
  'TRANSFERRED',
  'RETURNED',
  'RECALLED',
  'RELEASED',
  'DESTROYED',
  'CORRECTED',
] as const;

export type SerialEventType = (typeof SERIAL_EVENT_TYPES)[number];

/** The status an event leaves the pack in. */
const RESULTING_STATUS: Record<SerialEventType, SerialStatus | null> = {
  RECEIVED: 'IN_STOCK',
  DISPENSED: 'DISPENSED',
  SOLD: 'SOLD',
  TRANSFERRED: 'TRANSFERRED',
  RETURNED: 'RETURNED',
  RECALLED: 'RECALLED',
  RELEASED: 'IN_STOCK',
  DESTROYED: 'DESTROYED',
  // A correction names its own target status; it is the one event that is not
  // a physical movement, which is why it is separately permissioned.
  CORRECTED: null,
};

/**
 * Which events may be recorded against a pack in a given status.
 *
 * DESTROYED is terminal on purpose: once a pack has been incinerated under a
 * disposal certificate, any later "movement" is a data error, and silently
 * accepting it would make the destruction record worthless. Correcting such a
 * row is possible, but only through CORRECTED, which is audited and requires a
 * reason.
 */
const ALLOWED: Record<SerialStatus, SerialEventType[]> = {
  IN_STOCK: ['DISPENSED', 'SOLD', 'TRANSFERRED', 'RECALLED', 'DESTROYED', 'CORRECTED'],
  // A pack in transit is received at the far end, or intercepted by a recall.
  TRANSFERRED: ['RECEIVED', 'RECALLED', 'DESTROYED', 'CORRECTED'],
  // Already with a patient or customer: it can only come back.
  DISPENSED: ['RETURNED', 'RECALLED', 'CORRECTED'],
  SOLD: ['RETURNED', 'RECALLED', 'CORRECTED'],
  // A returned pack is quarantined by default: it goes back to stock only
  // after a release decision, or to disposal.
  RETURNED: ['RELEASED', 'DESTROYED', 'RECALLED', 'CORRECTED'],
  // A recalled pack is released only when the recall is closed as unfounded.
  RECALLED: ['DESTROYED', 'RELEASED', 'CORRECTED'],
  DESTROYED: ['CORRECTED'],
};

export interface TransitionCheck {
  ok: boolean;
  /** Why the transition was refused, phrased for the person who attempted it. */
  reason?: string;
  toStatus?: SerialStatus;
}

export function isSerialStatus(value: string): value is SerialStatus {
  return (SERIAL_STATUSES as readonly string[]).includes(value);
}

export function isSerialEventType(value: string): value is SerialEventType {
  return (SERIAL_EVENT_TYPES as readonly string[]).includes(value);
}

export function checkTransition(
  from: string,
  event: SerialEventType,
  correctedTo?: string,
): TransitionCheck {
  if (!isSerialStatus(from)) {
    return { ok: false, reason: `Serial is in unknown status "${from}"` };
  }

  if (!ALLOWED[from].includes(event)) {
    return {
      ok: false,
      reason: `A serial that is ${from} cannot be ${event}. Allowed from here: ${ALLOWED[from].join(', ')}`,
    };
  }

  if (event === 'CORRECTED') {
    if (!correctedTo || !isSerialStatus(correctedTo)) {
      return {
        ok: false,
        reason: `A correction must name the corrected status (one of ${SERIAL_STATUSES.join(', ')})`,
      };
    }
    return { ok: true, toStatus: correctedTo };
  }

  return { ok: true, toStatus: RESULTING_STATUS[event] as SerialStatus };
}

/** The events that are legal right now — what the UI should offer. */
export function allowedEvents(from: string): SerialEventType[] {
  return isSerialStatus(from) ? [...ALLOWED[from]] : [];
}
