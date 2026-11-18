/** Subset of HA's area registry entries we care about. */
export interface HaArea {
  area_id: string;
  name: string;
  floor_id: string | null;
}

/** Subset of HA's device registry entries we care about. */
export interface HaDevice {
  id: string;
  name: string | null;
  name_by_user: string | null;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  entry_type: string | null;
  /** The hub/bridge/coordinator this device is reached through, per HA's
   *  own registry (Zigbee node → coordinator, Hue bulb → bridge, Z-Wave
   *  node → controller). Null for devices HA talks to directly. Optional so
   *  older fixtures and tests need no change. */
  via_device_id?: string | null;
  /** Config entry ids this device belongs to; resolve to integration
   *  domains with listConfigEntries(). */
  config_entries?: string[];
  /** Registry identifiers, e.g. [["zha","00:12:4b:…"],["mqtt","zigbee2mqtt_0x…"]]. */
  identifiers?: Array<[string, string]>;
  /** Physical connections, e.g. [["mac","aa:bb:…"],["zigbee","00:12:…"]]. */
  connections?: Array<[string, string]>;
}

/** The subset of HA's core config (`get_config`) used for app defaults. */
export interface HaCoreConfig {
  currency: string | null;
  country: string | null;
  language: string | null;
  time_zone: string | null;
  /** "metric" | "us_customary" */
  unit_system: string | null;
}

/** A config entry = one configured integration instance. */
export interface HaConfigEntry {
  entry_id: string;
  domain: string;
  title: string;
}

/** Subset of HA's floor registry entries we care about. */
export interface HaFloor {
  floor_id: string;
  name: string;
  level: number | null;
}

/** Subset of HA's entity registry entries we care about. `platform` is the
 *  integration handling the entity (zha, mqtt, matter, zwave_js, esphome,
 *  ...) — a far more reliable protocol signal than trying to match a
 *  manufacturer/model string against an external database, since it's what
 *  HA itself determined when the device was actually paired. */
export interface HaEntity {
  entity_id: string;
  device_id: string | null;
  platform: string;
  device_class: string | null;
}

export interface HaRegistryClient {
  listAreas(): Promise<HaArea[]>;
  listDevices(): Promise<HaDevice[]>;
  listFloors(): Promise<HaFloor[]>;
  listEntities(): Promise<HaEntity[]>;
  /** Optional: not every client can resolve config entries. */
  listConfigEntries?(): Promise<HaConfigEntry[]>;
  /** Optional: HA core config (currency, country, units…). */
  getCoreConfig?(): Promise<HaCoreConfig>;
  /** Optional: current entities of one domain (e.g. ai_task) with friendly names. */
  listStatesByDomain?(domain: string): Promise<Array<{ entity_id: string; name: string | null }>>;
  /** Optional: several read commands over one connection (see WsHaRegistryClient.batch). */
  batch?(requests: HaBatchRequest[], timeoutMs?: number): Promise<HaBatchResult[]>;
  ping(): Promise<boolean>;
}

export interface HaBatchRequest {
  type: string;
  data?: Record<string, unknown>;
  /** Subscription: return its first event instead of the (empty) result. */
  snapshot?: boolean;
}

export type HaBatchResult = { ok: true; result: unknown } | { ok: false; error: string };

export const HA_REGISTRY_CLIENT = Symbol('HA_REGISTRY_CLIENT');
