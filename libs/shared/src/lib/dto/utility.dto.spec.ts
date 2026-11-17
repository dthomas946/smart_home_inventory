import { circuitOf, circuitSummary, UtilityProviderSchema } from './utility.dto';

describe('circuits', () => {
  it('reads a circuit from metadata and summarises it', () => {
    const c = circuitOf({ auto: false, circuit: { breaker: '12/14', amps: 30, poles: 2, serves: 'Dryer' } });
    expect(c?.amps).toBe(30);
    expect(circuitSummary(c)).toBe('#12/14 · 30A 2-pole');
  });
  it('ignores missing, empty or malformed circuits', () => {
    expect(circuitOf(null)).toBeNull();
    expect(circuitOf({ circuit: {} })).toBeNull();
    expect(circuitOf({ circuit: { amps: 'lots' } })).toBeNull();
  });
});

describe('UtilityProviderSchema', () => {
  it('turns blank optional fields into null', () => {
    const p = UtilityProviderSchema.parse({ utility: 'gas', name: ' CenterPoint ', phone: '' });
    expect(p.name).toBe('CenterPoint');
    expect(p.phone).toBeNull();
  });
});
