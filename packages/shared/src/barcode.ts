/**
 * Barcode symbol generation for label printing (§62).
 *
 * Implements Code 128 (including GS1-128, the FNC1 variant that carries GS1
 * Application Identifiers) and EAN-13, rendered as SVG so labels print at the
 * printer's own resolution rather than being resampled from a bitmap.
 *
 * NOT implemented: GS1 DataMatrix. Encoding ECC200 needs Reed-Solomon error
 * correction and a placement matrix; rather than emit something that scans
 * inconsistently, `buildLabel` uses GS1-128 — which is a legitimate GS1 carrier
 * for the same Application Identifiers — and says so. A plain QR code is never
 * substituted, because §62/§73 forbid treating one as GS1 identification.
 */

/** Code 128 bar/space width patterns, values 0-106. */
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;
const FNC1 = 102;
const CODE_B = 100;
const CODE_C = 99;

/** The FNC1 / group separator that terminates variable-length AIs. */
const GS = String.fromCharCode(29);

export interface BarcodeSymbol {
  /** Alternating bar/space module widths, starting with a bar. */
  modules: number[];
  /** Total width in modules, for sizing. */
  totalModules: number;
  symbology: string;
  humanReadable: string;
}

/**
 * Encode Code 128. With `gs1`, a leading FNC1 is emitted and every group
 * separator in the payload becomes an FNC1, which is what makes it GS1-128.
 */
export function encodeCode128(data: string, options: { gs1?: boolean } = {}): BarcodeSymbol {
  const codes: number[] = [];

  // Long digit runs pack two per symbol in code set C, which is why GS1-128
  // labels stay narrow enough to fit a shelf edge.
  const digitsAhead = (from: number): number => {
    let n = 0;
    while (from + n < data.length && data[from + n] >= '0' && data[from + n] <= '9') n++;
    return n;
  };

  let mode: 'B' | 'C';
  let i = 0;
  const leadingDigits = digitsAhead(0);

  if (leadingDigits >= 4) {
    mode = 'C';
    codes.push(START_C);
  } else {
    mode = 'B';
    codes.push(START_B);
  }
  if (options.gs1) codes.push(FNC1);

  while (i < data.length) {
    const char = data[i];

    if (char === GS) {
      // A separator inside the payload is an FNC1, not a data character.
      codes.push(FNC1);
      i += 1;
      continue;
    }

    if (mode === 'C') {
      const run = digitsAhead(i);
      if (run >= 2) {
        codes.push(Number(data.slice(i, i + 2)));
        i += 2;
        continue;
      }
      codes.push(CODE_B);
      mode = 'B';
      continue;
    }

    const run = digitsAhead(i);
    if (run >= 6 && run % 2 === 0) {
      codes.push(CODE_C);
      mode = 'C';
      continue;
    }

    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Code 128 cannot encode character 0x${code.toString(16)}`);
    }
    codes.push(code - 32);
    i += 1;
  }

  // Modulo-103 checksum, weighted by symbol position.
  let checksum = codes[0];
  for (let p = 1; p < codes.length; p++) checksum += codes[p] * p;
  codes.push(checksum % 103);
  codes.push(STOP);

  const modules: number[] = [];
  for (const code of codes) {
    for (const width of CODE128_PATTERNS[code]) modules.push(Number(width));
  }

  return {
    modules,
    totalModules: modules.reduce((a, b) => a + b, 0),
    symbology: options.gs1 ? 'GS1-128' : 'CODE128',
    humanReadable: data.replace(new RegExp(GS, 'g'), ' '),
  };
}

// ---- EAN-13 ----

const EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
/** Which of the first six digits use the G set, selected by the leading digit. */
const EAN_PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

export function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function encodeEan13(input: string): BarcodeSymbol {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 12 && digits.length !== 13) {
    throw new Error(`EAN-13 needs 12 or 13 digits, received ${digits.length}`);
  }
  const twelve = digits.slice(0, 12);
  const code = twelve + ean13CheckDigit(twelve);

  const parity = EAN_PARITY[Number(code[0])];
  let bits = '101'; // start guard
  for (let i = 1; i <= 6; i++) {
    bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(code[i])];
  }
  bits += '01010'; // centre guard
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(code[i])];
  bits += '101'; // end guard

  // Collapse the bit string into alternating run lengths, starting with a bar.
  const modules: number[] = [];
  let current = '1';
  let run = 0;
  for (const bit of bits) {
    if (bit === current) run += 1;
    else {
      modules.push(run);
      current = bit;
      run = 1;
    }
  }
  modules.push(run);

  return {
    modules,
    totalModules: bits.length,
    symbology: 'EAN13',
    humanReadable: code,
  };
}

// ---- SVG rendering ----

export interface RenderOptions {
  /** Width of one narrow module, in millimetres. 0.33mm is the GS1 nominal. */
  moduleWidthMm?: number;
  heightMm?: number;
  showText?: boolean;
  quietZoneModules?: number;
}

export function renderBarcodeSvg(symbol: BarcodeSymbol, options: RenderOptions = {}): string {
  const mw = options.moduleWidthMm ?? 0.33;
  const height = options.heightMm ?? 12;
  const quiet = options.quietZoneModules ?? 10;
  const showText = options.showText ?? true;
  const textHeight = showText ? 3.2 : 0;

  const totalWidth = (symbol.totalModules + quiet * 2) * mw;
  const totalHeight = height + textHeight;

  let x = quiet * mw;
  let isBar = true;
  const bars: string[] = [];

  for (const width of symbol.modules) {
    const w = width * mw;
    if (isBar) {
      bars.push(`<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${height}" />`);
    }
    x += w;
    isBar = !isBar;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}mm" height="${totalHeight.toFixed(2)}mm" viewBox="0 0 ${totalWidth.toFixed(2)} ${totalHeight.toFixed(2)}" role="img" aria-label="${symbol.symbology} ${symbol.humanReadable}">
  <rect width="100%" height="100%" fill="#fff"/>
  <g fill="#000">${bars.join('')}</g>
  ${
    showText
      ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${(height + 2.6).toFixed(2)}" font-family="monospace" font-size="2.6" text-anchor="middle" fill="#000">${escapeXml(symbol.humanReadable)}</text>`
      : ''
  }
</svg>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Choose the right symbology for what is being labelled.
 *
 * A batch or expiry can only be carried by a GS1 AI-bearing symbol, so those
 * labels use GS1-128. A plain retail pack with nothing but a GTIN uses EAN-13.
 */
export function buildLabelBarcode(input: {
  gtin: string;
  batchNumber?: string;
  expiryDate?: Date;
  serialNumber?: string;
}): { svg: string; symbology: string; encoded: string; note?: string } {
  const carriesAis = !!(input.batchNumber || input.expiryDate || input.serialNumber);

  if (!carriesAis && /^\d{12,13}$/.test(input.gtin)) {
    const symbol = encodeEan13(input.gtin);
    return {
      svg: renderBarcodeSvg(symbol, { heightMm: 14 }),
      symbology: 'EAN13',
      encoded: symbol.humanReadable,
    };
  }

  const parts: string[] = [`01${input.gtin.padStart(14, '0')}`];
  if (input.expiryDate) {
    const d = input.expiryDate;
    parts.push(
      `17${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`,
    );
  }
  if (input.batchNumber) parts.push(`10${input.batchNumber}${GS}`);
  if (input.serialNumber) parts.push(`21${input.serialNumber}`);

  const encoded = parts.join('').replace(new RegExp(`${GS}$`), '');
  const symbol = encodeCode128(encoded, { gs1: true });

  return {
    svg: renderBarcodeSvg(symbol, { heightMm: 14 }),
    symbology: 'GS1-128',
    encoded,
    note:
      'GS1-128 carries the same Application Identifiers as a GS1 DataMatrix. ' +
      'Use DataMatrix on packs too small for a linear symbol.',
  };
}
