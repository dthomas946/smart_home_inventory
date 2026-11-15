import { HaDevice } from './ha-registry.types';
import { exclusionReason, integrationsOf } from './device-exclusion';

const dev = (over: Partial<HaDevice> = {}): HaDevice => ({
  id: 'd1',
  name: 'Thing',
  name_by_user: null,
  manufacturer: 'Acme',
  model: 'X1',
  area_id: null,
  entry_type: null,
  via_device_id: null,
  config_entries: [],
  identifiers: [],
  connections: [],
  ...over,
});
const none = { manufacturers: [], integrations: [], deviceIds: [] };

describe('exclusionReason', () => {
  it('keeps ordinary hardware', () => {
    expect(exclusionReason(dev(), ['zha'], none)).toBeNull();
  });

  it('drops HA service entries', () => {
    expect(exclusionReason(dev({ entry_type: 'service' }), [], none)).toBe('service entry');
  });

  it('drops devices whose integrations are all virtual', () => {
    expect(exclusionReason(dev(), ['hassio'], none)).toMatch(/^virtual/);
    expect(exclusionReason(dev(), ['met', 'sun'], none)).toMatch(/^virtual/);
  });

  it('keeps hardware that merely also has a virtual integration attached', () => {
    expect(exclusionReason(dev(), ['shelly', 'template'], none)).toBeNull();
  });

  it('applies manufacturer rules case-insensitively (Downdetector feeds over MQTT)', () => {
    const d = dev({ manufacturer: 'Downdetector', model: 'Spike Monitor' });
    expect(exclusionReason(d, ['mqtt'], none)).toBeNull();
    expect(exclusionReason(d, ['mqtt'], { ...none, manufacturers: ['downdetector'] })).toBe(
      'manufacturer: Downdetector'
    );
  });

  it('applies integration and single-device rules', () => {
    expect(exclusionReason(dev(), ['mqtt'], { ...none, integrations: ['mqtt'] })).toBe(
      'integration: mqtt'
    );
    expect(exclusionReason(dev({ id: 'zz' }), ['zha'], { ...none, deviceIds: ['zz'] })).toBe(
      'excluded by you'
    );
  });

  it('drops cloud-account pseudo devices named after an email', () => {
    const d = dev({ name: 'Aarlo for someone@example.com', model: null });
    expect(exclusionReason(d, ['aarlo'], none)).toBe('cloud account');
  });

  it('maps config entries to integration domains', () => {
    const d = dev({ config_entries: ['a', 'b', 'missing'] });
    expect(
      integrationsOf(d, [
        { entry_id: 'a', domain: 'zha', title: '' },
        { entry_id: 'b', domain: 'template', title: '' },
      ])
    ).toEqual(['template', 'zha']);
  });
});
