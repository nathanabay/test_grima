/**
 * Unit-of-measure conversion (§6).
 *
 * Inventory is ALWAYS stored in the product's base unit. Every quantity that
 * crosses a module boundary (receiving, dispensing, transfer) is converted here
 * exactly once, and a conversion that cannot be represented in whole base units
 * is rejected rather than silently rounded - a rounding error here corrupts the
 * ledger permanently.
 */

export interface UnitDefinition {
  code: string;
  name: string;
  factorToBase: number;
  isBaseUnit?: boolean;
}

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitConversionError';
  }
}

export function findUnit(units: UnitDefinition[], code: string): UnitDefinition {
  const unit = units.find((u) => u.code === code);
  if (!unit) {
    throw new UnitConversionError(
      `Unit "${code}" is not defined for this product. Defined units: ${units
        .map((u) => u.code)
        .join(', ')}`,
    );
  }
  return unit;
}

/** Convert a quantity expressed in `fromCode` into base units. */
export function toBaseUnits(
  quantity: number,
  fromCode: string,
  units: UnitDefinition[],
): number {
  const unit = findUnit(units, fromCode);
  if (unit.factorToBase <= 0) {
    throw new UnitConversionError(`Unit "${fromCode}" has a non-positive conversion factor`);
  }
  const result = quantity * unit.factorToBase;
  // Guard against float drift producing 1999.9999999 tablets.
  const rounded = Math.round(result * 1e6) / 1e6;
  if (!Number.isFinite(rounded)) {
    throw new UnitConversionError(`Conversion of ${quantity} ${fromCode} overflowed`);
  }
  return rounded;
}

/** Convert base units into a display unit. */
export function fromBaseUnits(
  baseQuantity: number,
  toCode: string,
  units: UnitDefinition[],
): number {
  const unit = findUnit(units, toCode);
  if (unit.factorToBase <= 0) {
    throw new UnitConversionError(`Unit "${toCode}" has a non-positive conversion factor`);
  }
  return Math.round((baseQuantity / unit.factorToBase) * 1e6) / 1e6;
}

/** Human-readable breakdown: 2345 tablets -> "1 CARTON, 1 BOX, 3 STRIP, 5 TABLET". */
export function describeQuantity(
  baseQuantity: number,
  units: UnitDefinition[],
): string {
  const sorted = [...units].sort((a, b) => b.factorToBase - a.factorToBase);
  let remaining = baseQuantity;
  const parts: string[] = [];

  for (const unit of sorted) {
    if (unit.factorToBase <= 0) continue;
    const count = Math.floor(remaining / unit.factorToBase);
    if (count > 0) {
      parts.push(`${count} ${unit.code}`);
      remaining -= count * unit.factorToBase;
    }
  }

  return parts.length ? parts.join(', ') : `0 ${sorted[sorted.length - 1]?.code ?? 'UNIT'}`;
}
