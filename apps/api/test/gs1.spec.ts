import {
  GROUP_SEPARATOR as GS,
  buildGs1,
  isValidGtin,
  parseBarcode,
  parseGs1Date,
} from '../../../packages/shared/src/gs1';

describe('GS1 DataMatrix parsing (§17)', () => {
  it('parses GTIN, expiry, batch and serial from a full element string', () => {
    const code = `010890123456789017280531` + `10AMX26001${GS}` + `21SN00042`;
    const parsed = parseBarcode(code);

    expect(parsed.format).toBe('GS1_DATAMATRIX');
    expect(parsed.isGs1).toBe(true);
    expect(parsed.gtin).toBe('08901234567890');
    expect(parsed.batchNumber).toBe('AMX26001');
    expect(parsed.serialNumber).toBe('SN00042');
    expect(parsed.expiryDate?.toISOString().slice(0, 10)).toBe('2028-05-31');
  });

  it('treats a GS1 day of 00 as the last day of that month', () => {
    expect(parseGs1Date('280200')?.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(parseGs1Date('270200')?.toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('parses bracket notation emitted by some scanners', () => {
    const parsed = parseBarcode('(01)08901234567890(17)280531(10)AMX26001');
    expect(parsed.gtin).toBe('08901234567890');
    expect(parsed.batchNumber).toBe('AMX26001');
  });

  it('flags a GTIN whose check digit does not validate', () => {
    const parsed = parseBarcode('010890123456789117280531');
    expect(parsed.errors.some((e) => e.includes('check-digit'))).toBe(true);
  });

  it('validates GTIN check digits', () => {
    expect(isValidGtin('08901234567890')).toBe(true);
    expect(isValidGtin('08901234567891')).toBe(false);
  });

  it('marks a plain EAN-13 as NOT GS1, so batch and expiry are not trusted', () => {
    const parsed = parseBarcode('5901234123457');
    expect(parsed.format).toBe('EAN13');
    expect(parsed.isGs1).toBe(false);
    expect(parsed.batchNumber).toBeUndefined();
    expect(parsed.expiryDate).toBeUndefined();
  });

  it('round-trips through the label encoder', () => {
    const encoded = buildGs1({
      gtin: '08901234567890',
      batchNumber: 'AMX26001',
      expiryDate: new Date(Date.UTC(2028, 4, 31)),
      serialNumber: 'SN00042',
    });
    const parsed = parseBarcode(encoded);

    expect(parsed.gtin).toBe('08901234567890');
    expect(parsed.batchNumber).toBe('AMX26001');
    expect(parsed.serialNumber).toBe('SN00042');
    expect(parsed.expiryDate?.toISOString().slice(0, 10)).toBe('2028-05-31');
  });
});
