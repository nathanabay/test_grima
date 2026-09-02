import {
  UnitConversionError,
  describeQuantity,
  fromBaseUnits,
  toBaseUnits,
} from '../../../packages/shared/src/units';

// 1 carton = 20 boxes = 200 strips = 2000 tablets
const UNITS = [
  { code: 'TABLET', name: 'Tablet', factorToBase: 1, isBaseUnit: true },
  { code: 'STRIP', name: 'Strip', factorToBase: 10 },
  { code: 'BOX', name: 'Box', factorToBase: 100 },
  { code: 'CARTON', name: 'Carton', factorToBase: 2000 },
];

describe('Unit conversion (§6)', () => {
  it('converts purchase units down to base units', () => {
    expect(toBaseUnits(1, 'CARTON', UNITS)).toBe(2000);
    expect(toBaseUnits(3, 'BOX', UNITS)).toBe(300);
    expect(toBaseUnits(7, 'STRIP', UNITS)).toBe(70);
  });

  it('converts base units back into display units', () => {
    expect(fromBaseUnits(2000, 'CARTON', UNITS)).toBe(1);
    expect(fromBaseUnits(250, 'STRIP', UNITS)).toBe(25);
  });

  it('rejects an unknown unit instead of guessing', () => {
    expect(() => toBaseUnits(1, 'PALLET', UNITS)).toThrow(UnitConversionError);
  });

  it('rejects a non-positive conversion factor', () => {
    expect(() =>
      toBaseUnits(1, 'BAD', [{ code: 'BAD', name: 'Bad', factorToBase: 0 }]),
    ).toThrow(UnitConversionError);
  });

  it('does not accumulate floating point drift', () => {
    expect(toBaseUnits(0.1 + 0.2, 'BOX', UNITS)).toBe(30);
  });

  it('describes a quantity across the unit ladder', () => {
    expect(describeQuantity(2345, UNITS)).toBe('1 CARTON, 3 BOX, 4 STRIP, 5 TABLET');
  });
});
