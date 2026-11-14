import { buildNotes, guessCategory, normalizeFields } from './label-scan.service';

describe('normalizeFields', () => {
  it('cleans strings, drops null-ish values and folds extra pairs into a map', () => {
    const f = normalizeFields({
      manufacturer: '  Carrier ',
      model: '24ACC636A003',
      serialNumber: 'null',
      productType: 'Split System Air Conditioner',
      manufactureDate: null,
      electrical: { voltage: '208/230', amps: 'RLA 14.1', watts: 'N/A', hz: '60', phase: '1' },
      extra: [
        { key: 'Refrigerant', value: 'R-410A' },
        { key: 'Charge', value: '7 lb 2 oz' },
        { key: 'Empty', value: '' },
      ],
    });
    expect(f.manufacturer).toBe('Carrier');
    expect(f.serialNumber).toBeNull();
    expect(f.electrical.watts).toBeNull();
    expect(f.extra).toEqual({ Refrigerant: 'R-410A', Charge: '7 lb 2 oz' });
  });

  it('tolerates a completely wrong shape', () => {
    const f = normalizeFields('garbage');
    expect(f.model).toBeNull();
    expect(f.extra).toEqual({});
  });
});

describe('guessCategory', () => {
  it('maps common nameplate wording to device categories', () => {
    expect(guessCategory('Split System Heat Pump')).toBe('air_handling_unit');
    expect(guessCategory('Gas Water Heater')).toBe('water_heater');
    expect(guessCategory('Refrigerator')).toBe('appliance');
    expect(guessCategory('Smart Thermostat')).toBe('thermostat');
    expect(guessCategory(null)).toBeNull();
    expect(guessCategory('Mystery Box')).toBeNull();
  });
});

describe('buildNotes', () => {
  it('renders electrical and extras as a notes block', () => {
    const notes = buildNotes(
      normalizeFields({
        electrical: { voltage: '230V', amps: '12', watts: null, hz: '60', phase: null },
        manufactureDate: '03/2019',
        extra: [{ key: 'Refrigerant', value: 'R-410A' }],
      })
    );
    expect(notes).toContain('Electrical: 230V, 12 A, 60 Hz');
    expect(notes).toContain('Manufactured: 03/2019');
    expect(notes).toContain('Refrigerant: R-410A');
  });
  it('is empty when nothing useful was read', () => {
    expect(buildNotes(normalizeFields({}))).toBe('');
  });
});
