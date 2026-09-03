import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * A rejection that names the input that caused it.
 *
 * Every validation failure used to arrive as one sentence with no indication
 * of which field it was about, so the screen could only show a banner at the
 * top and leave the reader to work out which of eleven inputs was meant. The
 * `Field` primitive has taken an `error` prop from the beginning; it had
 * nothing to put in it.
 *
 * The field name is the one the form submits, so the client can mark that
 * input without parsing English.
 */
export class FieldError extends BadRequestException {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super({ message, field });
  }
}

/**
 * A refusal on authorization grounds that still names the input.
 *
 * A discount above the ceiling a cashier may give is not a malformed request —
 * it is one they are not allowed to make — so it stays a 403. The field is
 * carried all the same, so the till marks the discount box rather than adding
 * a line of red text above the whole sale.
 */
export class ForbiddenFieldError extends ForbiddenException {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super({ message, field });
  }
}

/** Throws when a required value is absent, naming it. */
export function required(value: unknown, field: string, label: string): void {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new FieldError(field, `${label} is required`);
  }
}
