/**
 * Decoders for the codes printed on device labels — QR codes and barcodes
 * read in the browser before "Scan label" sends the photo to the AI.
 * Pure functions: no network. The backend adds registry lookups (Matter DCL).
 */

export type ScannedCodeKind = 'matter' | 'homekit' | 'zwave' | 'gs1' | 'url' | 'text';

export interface ScannedCode {
  raw: string;
  kind: ScannedCodeKind;
  /** One line for the UI and the AI prompt. */
  summary: string;
  matter?: { vendorId: number; productId: number };
  homekit?: { category: number; categoryName: string | null };
  zwave?: { manufacturerId: number; productType: number; productId: number; manufacturerName: string | null };
  gs1?: { gtin: string | null; serial: string | null; batch: string | null };
  url?: string;
}

// ---------------------------------------------------------------------------
// Matter onboarding payload ("MT:…", base38)
// ---------------------------------------------------------------------------

const BASE38 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.';

function base38Decode(s: string): number[] | null {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; ) {
    const left = s.length - i;
    const chars = left >= 5 ? 5 : left === 4 ? 4 : left === 2 ? 2 : 0;
    const nBytes = chars === 5 ? 3 : chars === 4 ? 2 : chars === 2 ? 1 : 0;
    if (!chars) return null;
    let v = 0;
    for (let j = chars - 1; j >= 0; j--) {
      const d = BASE38.indexOf(s[i + j]);
      if (d < 0) return null;
      v = v * 38 + d;
    }
    for (let b = 0; b < nBytes; b++) {
      bytes.push(v & 0xff);
      v = Math.floor(v / 256);
    }
    i += chars;
  }
  return bytes;
}

/** Read `bits` bits starting at bit `offset` (little-endian, LSB first). */
function readBits(bytes: number[], offset: number, bits: number): number {
  let v = 0;
  for (let i = 0; i < bits; i++) {
    const bit = offset + i;
    if ((bytes[bit >> 3] >> (bit & 7)) & 1) v += 2 ** i;
  }
  return v;
}

export function decodeMatterQr(text: string): { vendorId: number; productId: number } | null {
  const m = /^MT:([0-9A-Z.\-]+)$/.exec(text.trim());
  if (!m) return null;
  const bytes = base38Decode(m[1]);
  if (!bytes || bytes.length < 11) return null;
  // version(3) vendorId(16) productId(16) flow(2) rendezvous(8) discriminator(12) passcode(27)
  return { vendorId: readBits(bytes, 3, 16), productId: readBits(bytes, 19, 16) };
}

// ---------------------------------------------------------------------------
// HomeKit setup payload ("X-HM://…", base36)
// ---------------------------------------------------------------------------

const HOMEKIT_CATEGORIES: Record<number, string> = {
  1: 'Other', 2: 'Bridge', 3: 'Fan', 4: 'Garage door opener', 5: 'Light bulb', 6: 'Door lock',
  7: 'Outlet', 8: 'Switch', 9: 'Thermostat', 10: 'Sensor', 11: 'Security system', 12: 'Door',
  13: 'Window', 14: 'Window covering', 15: 'Programmable switch', 16: 'Range extender',
  17: 'IP camera', 18: 'Video doorbell', 19: 'Air purifier', 20: 'Heater', 21: 'Air conditioner',
  22: 'Humidifier', 23: 'Dehumidifier', 28: 'Sprinkler', 29: 'Faucet', 30: 'Shower system',
  31: 'Television', 32: 'Remote', 33: 'Router',
};

export function decodeHomeKitQr(text: string): { category: number; categoryName: string | null } | null {
  const m = /^X-HM:\/\/([0-9A-Z]{9})/i.exec(text.trim());
  if (!m) return null;
  // 9 base-36 chars < 2^53, so plain numbers are exact here.
  const v = parseInt(m[1].toUpperCase(), 36);
  const category = Math.floor(v / 2 ** 31) % 256;
  return { category, categoryName: HOMEKIT_CATEGORIES[category] ?? null };
}

// ---------------------------------------------------------------------------
// Z-Wave SmartStart (all digits, starts with "90")
// ---------------------------------------------------------------------------

/** A few common Z-Wave manufacturer ids; the AI gets the hex id either way. */
const ZWAVE_MANUFACTURERS: Record<number, string> = {
  0x0000: 'Sigma Designs', 0x0039: 'Honeywell', 0x0063: 'GE / Jasco', 0x0086: 'Aeotec',
  0x010f: 'Fibaro', 0x0154: 'Popp', 0x0159: 'Qubino', 0x0175: 'Devolo', 0x027a: 'Zooz',
  0x0312: 'Minoston', 0x0315: 'Shenzhen Neo', 0x031e: 'Inovelli', 0x033b: 'Ring',
  0x0346: 'Ring', 0x0371: 'Aeotec', 0x0373: 'Leviton', 0x001d: 'Leviton', 0x0060: 'Everspring',
  0x014a: 'Ecolink', 0x0109: 'Vision Security', 0x0184: 'Dragon Tech', 0x0208: 'Hank',
};

export function decodeZwaveSmartStart(
  text: string
): { manufacturerId: number; productType: number; productId: number; manufacturerName: string | null } | null {
  const s = text.trim();
  if (!/^90\d{88,}$/.test(s)) return null;
  // lead(2) version(2) checksum(5) requested keys(3) DSK(40) = 52, then TLVs:
  // type(2: id<<1 | critical) length(2) value(length digits).
  let i = 52;
  while (i + 4 <= s.length) {
    const typeField = Number(s.slice(i, i + 2));
    const len = Number(s.slice(i + 2, i + 4));
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length < len) break;
    if (typeField >> 1 === 1 && len >= 15) {
      // Product ID TLV: manufacturer(5) product type(5) product id(5) app version(5)
      const manufacturerId = Number(value.slice(0, 5));
      return {
        manufacturerId,
        productType: Number(value.slice(5, 10)),
        productId: Number(value.slice(10, 15)),
        manufacturerName: ZWAVE_MANUFACTURERS[manufacturerId] ?? null,
      };
    }
    i += 4 + len;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GS1 (product barcode with serial): "(01)…(21)…" or a GS1 Digital Link URL
// ---------------------------------------------------------------------------

export function decodeGs1(text: string): { gtin: string | null; serial: string | null; batch: string | null } | null {
  const t = text.trim();
  const pick = (ai: string) => {
    const bracketed = new RegExp(`\\(${ai}\\)([^()]+)`).exec(t);
    if (bracketed) return bracketed[1].trim();
    const link = new RegExp(`/${ai}/([^/?#]+)`).exec(t);
    return link ? decodeURIComponent(link[1]) : null;
  };
  // Raw element string with the FNC1 separator (ASCII 29), as scanners return it.
  if (/^01\d{14}/.test(t) && !t.includes('(')) {
    const gtin = t.slice(2, 16);
    const rest = t.slice(16).split('\u001d');
    let serial: string | null = null;
    let batch: string | null = null;
    for (const part of rest) {
      if (part.startsWith('21')) serial = part.slice(2) || null;
      else if (part.startsWith('10')) batch = part.slice(2) || null;
    }
    return { gtin, serial, batch };
  }
  // Plain retail barcode (EAN-8/UPC-A/EAN-13/GTIN-14) as a barcode reader returns it.
  if (/^(\d{8}|\d{12,14})$/.test(t)) return { gtin: t, serial: null, batch: null };
  const gtin = pick('01');
  if (!gtin || !/^\d{8,14}$/.test(gtin)) return null;
  return { gtin, serial: pick('21'), batch: pick('10') };
}

// ---------------------------------------------------------------------------

const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

export function parseScannedCode(raw: string): ScannedCode {
  const text = raw.trim();
  const matter = decodeMatterQr(text);
  if (matter) {
    return {
      raw: text,
      kind: 'matter',
      matter,
      summary: `Matter setup code: vendor ${hex4(matter.vendorId)}, product ${hex4(matter.productId)}`,
    };
  }
  const hk = decodeHomeKitQr(text);
  if (hk) {
    return {
      raw: text,
      kind: 'homekit',
      homekit: hk,
      summary: `HomeKit setup code: accessory category ${hk.categoryName ?? hk.category}`,
    };
  }
  const zw = decodeZwaveSmartStart(text);
  if (zw) {
    return {
      raw: text,
      kind: 'zwave',
      zwave: zw,
      summary:
        `Z-Wave SmartStart code: manufacturer ${hex4(zw.manufacturerId)}` +
        `${zw.manufacturerName ? ` (${zw.manufacturerName})` : ''}, product type ${hex4(zw.productType)}, product id ${hex4(zw.productId)}`,
    };
  }
  const gs1 = decodeGs1(text);
  if (gs1) {
    return {
      raw: text,
      kind: 'gs1',
      gs1,
      ...(/^https?:\/\//i.test(text) ? { url: text } : {}),
      summary: `GS1 product code: GTIN ${gs1.gtin}${gs1.serial ? `, serial ${gs1.serial}` : ''}${gs1.batch ? `, batch ${gs1.batch}` : ''}`,
    };
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    return { raw: text, kind: 'url', url: text, summary: `Web link: ${text}` };
  }
  return { raw: text, kind: 'text', summary: `Code text: ${text.slice(0, 300)}` };
}
