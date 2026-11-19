import { decodeHomeKitQr, decodeMatterQr, decodeZwaveSmartStart, parseScannedCode } from './scanned-codes';

describe('Matter QR', () => {
  it('decodes the Matter SDK test payload', () => {
    // CHIP/Matter reference code: VID 0xFFF1, PID 0x8000.
    expect(decodeMatterQr('MT:Y.K9042C00KA0648G00')).toEqual({ vendorId: 0xfff1, productId: 0x8000 });
  });
  it('rejects other text', () => {
    expect(decodeMatterQr('https://example.com')).toBeNull();
  });
});

describe('HomeKit QR', () => {
  it('reads the accessory category', () => {
    // category 7 (Outlet) at bits 31–38
    const v = 7 * 2 ** 31 + 12345;
    const payload = v.toString(36).toUpperCase().padStart(9, '0');
    expect(decodeHomeKitQr(`X-HM://${payload}ABCD`)).toEqual({ category: 7, categoryName: 'Outlet' });
  });
});

describe('Z-Wave SmartStart', () => {
  it('reads manufacturer and product from the Product ID TLV', () => {
    const header = '90' + '00' + '12345' + '001' + '1'.repeat(40);
    const productType = '00' + '10' + '0000100001'; // TLV 0 (ignored)
    const productId = '02' + '20' + '00134' + '00002' + '00100' + '00256'; // TLV 1
    const code = header + productType + productId;
    expect(decodeZwaveSmartStart(code)).toEqual({
      manufacturerId: 134,
      productType: 2,
      productId: 100,
      manufacturerName: 'Aeotec',
    });
  });
});

describe('parseScannedCode', () => {
  it('reads GS1 element strings and digital links', () => {
    expect(parseScannedCode('(01)00012345678905(21)SN12345').gs1).toEqual({
      gtin: '00012345678905',
      serial: 'SN12345',
      batch: null,
    });
    const link = parseScannedCode('https://id.gs1.org/01/00012345678905/21/ABC');
    expect(link.kind).toBe('gs1');
    expect(link.gs1?.serial).toBe('ABC');
  });
  it('treats other links as web links and anything else as text', () => {
    expect(parseScannedCode('https://example.com/p/123').kind).toBe('url');
    expect(parseScannedCode('SN:1234;MD:XY-9').kind).toBe('text');
  });
});
