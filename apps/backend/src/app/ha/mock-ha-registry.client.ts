import {
  HaArea,
  HaConfigEntry,
  HaCoreConfig,
  HaDevice,
  HaEntity,
  HaFloor,
  HaRegistryClient,
} from './ha-registry.types';
import {
  FIXTURE_AREAS,
  FIXTURE_DEVICES,
  FIXTURE_ENTITIES,
  FIXTURE_FLOORS,
} from './fixtures/registry.fixtures';

/**
 * Offline development client returning a small realistic registry so the
 * whole app (including sync) works without a Home Assistant instance.
 */
export class MockHaRegistryClient implements HaRegistryClient {
  async listAreas(): Promise<HaArea[]> {
    return FIXTURE_AREAS;
  }

  async listDevices(): Promise<HaDevice[]> {
    return FIXTURE_DEVICES;
  }

  async listFloors(): Promise<HaFloor[]> {
    return FIXTURE_FLOORS;
  }

  async listEntities(): Promise<HaEntity[]> {
    return FIXTURE_ENTITIES;
  }

  async getCoreConfig(): Promise<HaCoreConfig> {
    return {
      currency: 'EUR',
      country: 'DE',
      language: 'de',
      time_zone: 'Europe/Berlin',
      unit_system: 'metric',
    };
  }

  async listConfigEntries(): Promise<HaConfigEntry[]> {
    return [
      { entry_id: 'ce-hue', domain: 'hue', title: 'Philips Hue' },
      { entry_id: 'ce-zha', domain: 'zha', title: 'Zigbee Home Automation' },
    ];
  }

  async ping(): Promise<boolean> {
    return true;
  }
}
