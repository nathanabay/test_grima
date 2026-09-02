/**
 * GS1 Application Identifier parser for pharmaceutical DataMatrix codes (§17).
 *
 * A GS1 DataMatrix on a medicine pack encodes several element strings
 * concatenated together. Fixed-length AIs run straight into the next element;
 * variable-length AIs are terminated by the FNC1 group separator (ASCII 29).
 *
 * Example scan (GS = the group separator byte):
 *   0108901234567890 17280531 10AMX26001<GS> 21SN00042
 *   -> GTIN 08901234567890, expiry 2028-05-31, batch AMX26001, serial SN00042
 *
 * A plain QR code is NOT a substitute for this (§62/§73) — callers must check
 * `isGs1` before trusting these identifiers for regulated stock movements.
 */

/** FNC1 / group separator, ASCII 29. */
export const GROUP_SEPARATOR = String.fromCharCode(29);

/** Fixed-length AIs (value length excludes the AI itself). */
const FIXED_LENGTH_AIS: Record<string, number> = {
  '00': 18, // SSCC
  '01': 14, // GTIN
  '02': 14, // GTIN of contained trade items
  '11': 6, // production date YYMMDD
  '12': 6, // due date
  '13': 6, // packaging date
  '15': 6, // best before
  '16': 6, // sell by
  '17': 6, // expiry date YYMMDD
  '20': 2, // variant
};

/** Variable-length AIs we care about, with their maximum length. */
const VARIABLE_LENGTH_AIS: Record<string, number> = {
  '10': 20, // batch / lot
  '21': 20, // serial number
  '30': 8, // variable count
  '240': 30, // additional product identification
  '710': 20, // national healthcare reimbursement number
};

export type BarcodeFormat =
  | 'GS1_DATAMATRIX'
  | 'EAN13'
  | 'UPC'
  | 'CODE128'
  | 'UNKNOWN';

export interface ParsedBarcode {
  format: BarcodeFormat;
  /** True only for GS1 element strings — required for regulated identification. */
  isGs1: boolean;
  gtin?: string;
  batchNumber?: string;
  serialNumber?: string;
  expiryDate?: Date;
  productionDate?: Date;
  raw: string;
  /** AIs present in the code but not interpreted. */
  unparsed: Record<string, string>;
  errors: string[];
}

/**
 * GS1 dates are YYMMDD. Per the GS1 General Specifications a `00` day means
 * "last day of that month" — for medicines this is the meaningful expiry.
 * Century window follows the GS1 rule: yy 00-50 => 20yy, 51-99 => 19yy.
 */
export function parseGs1Date(value: string): Date | undefined {
  if (!/^\d{6}$/.test(value)) return undefined;
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;

  const year = yy <= 50 ? 2000 + yy : 1900 + yy;
  if (dd === 0) {
    // Day 0 of the following month = last day of this month.
    return new Date(Date.UTC(year, mm, 0, 23, 59, 59));
  }
  if (dd > 31) return undefined;
  return new Date(Date.UTC(year, mm - 1, dd, 23, 59, 59));
}

/** GTIN-8/12/13/14 mod-10 check digit. */
export function isValidGtin(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(gtin)) return false;
  const digits = gtin.split('').map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // Weights alternate 3,1 from the rightmost data digit leftwards.
  for (
    let i = digits.length - 1, weight = 3;
    i >= 0;
    i--, weight = weight === 3 ? 1 : 3
  ) {
    sum += digits[i] * weight;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Normalize any GTIN/EAN/UPC to 14 digits for master-data matching. */
export function normalizeGtin(code: string): string {
  return code.padStart(14, '0');
}

export function parseGs1(raw: string): ParsedBarcode {
  const result: ParsedBarcode = {
    format: 'GS1_DATAMATRIX',
    isGs1: true,
    raw,
    unparsed: {},
    errors: [],
  };

  // Strip a leading FNC1 and any bracket notation "(01)0890..." some scanners emit.
  let data = raw.startsWith(GROUP_SEPARATOR) ? raw.slice(1) : raw;
  if (data.includes('(')) data = data.replace(/[()]/g, '');

  let i = 0;
  let guard = 0;
  while (i < data.length && guard++ < 100) {
    if (data[i] === GROUP_SEPARATOR) {
      i += 1;
      continue;
    }

    // AIs are 2-4 digits; try the longest defined match first.
    let ai: string | undefined;
    for (const len of [4, 3, 2]) {
      const candidate = data.slice(i, i + len);
      if (
        candidate.length === len &&
        (FIXED_LENGTH_AIS[candidate] !== undefined ||
          VARIABLE_LENGTH_AIS[candidate] !== undefined)
      ) {
        ai = candidate;
        break;
      }
    }

    if (!ai) {
      result.errors.push(`Unrecognized application identifier at position ${i}`);
      break;
    }

    i += ai.length;
    let value: string;

    if (FIXED_LENGTH_AIS[ai] !== undefined) {
      const len = FIXED_LENGTH_AIS[ai];
      value = data.slice(i, i + len);
      if (value.length < len) {
        result.errors.push(`AI ${ai} truncated: expected ${len} characters`);
        break;
      }
      i += len;
    } else {
      const sepIndex = data.indexOf(GROUP_SEPARATOR, i);
      const end = sepIndex === -1 ? data.length : sepIndex;
      value = data.slice(i, Math.min(end, i + VARIABLE_LENGTH_AIS[ai]));
      i = end === data.length ? end : end + 1;
    }

    switch (ai) {
      case '01':
      case '02':
        result.gtin = value;
        if (!isValidGtin(value)) {
          result.errors.push(`GTIN ${value} failed check-digit validation`);
        }
        break;
      case '10':
        result.batchNumber = value;
        break;
      case '21':
        result.serialNumber = value;
        break;
      case '17': {
        const d = parseGs1Date(value);
        if (d) result.expiryDate = d;
        else result.errors.push(`Invalid expiry date "${value}"`);
        break;
      }
      case '11': {
        const d = parseGs1Date(value);
        if (d) result.productionDate = d;
        break;
      }
      default:
        result.unparsed[ai] = value;
    }
  }

  return result;
}

/**
 * Entry point for the scanning endpoints. Detects linear barcodes vs GS1
 * element strings so callers know whether batch/expiry are trustworthy.
 */
export function parseBarcode(raw: string): ParsedBarcode {
  const trimmed = raw.trim();

  const looksGs1 =
    trimmed.includes(GROUP_SEPARATOR) ||
    trimmed.startsWith('(') ||
    /^01\d{14}/.test(trimmed);

  if (looksGs1) return parseGs1(trimmed);

  if (/^\d{13}$/.test(trimmed)) {
    return {
      format: 'EAN13',
      isGs1: false,
      gtin: trimmed,
      raw: trimmed,
      unparsed: {},
      errors: isValidGtin(trimmed) ? [] : ['EAN-13 check digit invalid'],
    };
  }
  if (/^\d{12}$/.test(trimmed)) {
    return {
      format: 'UPC',
      isGs1: false,
      gtin: trimmed,
      raw: trimmed,
      unparsed: {},
      errors: isValidGtin(trimmed) ? [] : ['UPC check digit invalid'],
    };
  }

  return {
    format: /^[\x20-\x7E]+$/.test(trimmed) ? 'CODE128' : 'UNKNOWN',
    isGs1: false,
    raw: trimmed,
    unparsed: {},
    errors: [],
  };
}

/** Build a GS1 element string for label printing (§62). */
export function buildGs1(input: {
  gtin: string;
  batchNumber?: string;
  expiryDate?: Date;
  serialNumber?: string;
}): string {
  const parts: string[] = [`01${normalizeGtin(input.gtin)}`];
  if (input.expiryDate) {
    const d = input.expiryDate;
    const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    parts.push(`17${yy}${mm}${dd}`);
  }
  // Variable-length AIs must be separated from whatever follows them.
  if (input.batchNumber) parts.push(`10${input.batchNumber}${GROUP_SEPARATOR}`);
  if (input.serialNumber) parts.push(`21${input.serialNumber}`);
  return parts.join('').replace(new RegExp(`${GROUP_SEPARATOR}$`), '');
}
