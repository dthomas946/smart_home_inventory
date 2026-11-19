import { AiSettingsService } from '../settings/ai-settings.service';
import { LabelScanService, mergeFields } from './label-scan.service';
import { MatterDclService } from './matter-dcl.service';

const ai = {
  get: async () => ({ provider: 'none', scan: { maxImageEdge: 1280 } }),
  provider: () => null,
} as unknown as AiSettingsService;

describe('LabelScanService with codes', () => {
  it('fills the form from a Matter QR code alone (no AI)', async () => {
    const dcl = {
      lookup: jest.fn(async () => ({
        vendorName: 'Onvis',
        productName: 'Smart Plug S4',
        productLabel: 'Smart Plug',
        partNumber: 'S4-US',
        userManualUrl: 'https://example.com/manual.pdf',
        supportUrl: null,
        productUrl: null,
      })),
    } as unknown as MatterDclService;
    // Real encoding; vendor/product here are the SDK test ids, the mock answers anyway.
    const svc = new LabelScanService(ai, dcl);
    (dcl as unknown as { lookup: jest.Mock }).lookup.mockClear();
    const r = await svc.scan(null, null, ['MT:Y.K9042C00KA0648G00', 'https://example.com/p/1']);
    expect(dcl.lookup).toHaveBeenCalledWith(0xfff1, 0x8000);
    expect(r.fields.brand).toBe('Onvis');
    expect(r.fields.model).toBe('S4-US');
    expect(r.links.map((l) => l.label)).toEqual(['Manual (Matter registry)', 'Link from QR code']);
    expect(r.codes).toHaveLength(2);
    expect(r.notesSuggestion).toContain('Matter setup code');
  });

  it('refuses when there is neither an AI nor a code', async () => {
    const svc = new LabelScanService(ai, { lookup: jest.fn() } as unknown as MatterDclService);
    await expect(svc.scan(Buffer.from([1]), 'image/jpeg', [])).rejects.toThrow(/needs an AI provider/);
  });
});

describe('mergeFields', () => {
  const read = {
    manufacturer: 'Electrolux',
    brand: 'Frigidaire',
    model: 'FRSS2623AS?',
    serialNumber: '4A12345',
    productType: 'Refrigerator',
    manufactureDate: null,
    electrical: { voltage: '115V', amps: null, watts: null, hz: '60', phase: null },
    extra: {},
  };
  it('prefers registry identity, keeps the AI serial and specs', () => {
    const m = mergeFields(read, { brand: 'Frigidaire', model: 'FRSS2623AS', serialNumber: 'X' });
    expect(m.model).toBe('FRSS2623AS');
    expect(m.serialNumber).toBe('4A12345');
    expect(m.electrical.voltage).toBe('115V');
  });
});
