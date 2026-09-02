import {
  buildLabelBarcode,
  ean13CheckDigit,
  encodeCode128,
  encodeEan13,
  renderBarcodeSvg,
} from '../../../packages/shared/src/barcode';

const GS = String.fromCharCode(29);

describe('Code 128 / GS1-128 (§62)', () => {
  it('produces a symbol whose modules alternate bar and space', () => {
    const symbol = encodeCode128('ABC123');
    expect(symbol.modules.length).toBeGreaterThan(0);
    expect(symbol.totalModules).toBe(symbol.modules.reduce((a, b) => a + b, 0));
  });

  it('marks a GS1 payload as GS1-128, not plain Code 128', () => {
    expect(encodeCode128('0108901234567890', { gs1: true }).symbology).toBe('GS1-128');
    expect(encodeCode128('PLAIN').symbology).toBe('CODE128');
  });

  it('packs long digit runs into code set C, keeping the symbol narrow', () => {
    // Code set C encodes two digits per symbol, so the same payload in set B
    // would be materially wider.
    const numeric = encodeCode128('01234567890123456789');
    const alpha = encodeCode128('ABCDEFGHIJABCDEFGHIJ');
    expect(numeric.totalModules).toBeLessThan(alpha.totalModules);
  });

  it('encodes a group separator as FNC1 rather than a data character', () => {
    const withSeparator = encodeCode128(`10BATCH${GS}21SERIAL`, { gs1: true });
    expect(withSeparator.humanReadable).toBe('10BATCH 21SERIAL');
    expect(() => encodeCode128(`10BATCH${GS}`)).not.toThrow();
  });

  it('refuses a character Code 128 set B cannot represent', () => {
    expect(() => encodeCode128('café')).toThrow(/cannot encode/);
  });
});

describe('EAN-13 (§62)', () => {
  it('computes the check digit', () => {
    expect(ean13CheckDigit('590123412345')).toBe(7);
    expect(ean13CheckDigit('890100000000')).toBe(2);
  });

  it('appends the check digit to a 12-digit input', () => {
    expect(encodeEan13('590123412345').humanReadable).toBe('5901234123457');
  });

  it('always produces the standard 95-module symbol', () => {
    expect(encodeEan13('5901234123457').totalModules).toBe(95);
  });

  it('rejects the wrong number of digits', () => {
    expect(() => encodeEan13('12345')).toThrow(/12 or 13 digits/);
  });
});

describe('Label symbology selection (§62, §73)', () => {
  it('uses EAN-13 for a plain retail pack', () => {
    const label = buildLabelBarcode({ gtin: '8901000000002' });
    expect(label.symbology).toBe('EAN13');
  });

  it('uses GS1-128 once batch or expiry must be carried', () => {
    const label = buildLabelBarcode({
      gtin: '8901000000002',
      batchNumber: 'AMX26001',
      expiryDate: new Date(Date.UTC(2028, 4, 31)),
    });
    expect(label.symbology).toBe('GS1-128');
    expect(label.encoded).toContain('10AMX26001');
    expect(label.encoded).toContain('17280531');
    // Never silently substitutes a QR code for GS1 identification.
    expect(label.symbology).not.toMatch(/QR/);
  });

  it('renders scalable SVG with a quiet zone', () => {
    const svg = renderBarcodeSvg(encodeEan13('5901234123457'));
    expect(svg).toContain('<svg');
    expect(svg).toContain('mm');
    expect(svg).toContain('<rect');
  });
});
