import {
  AutoLinkMetadata,
  AutoLinkReason,
  ConnectionType,
  ControllerCandidateDto,
  PlannedLinkDto,
  SkippedDeviceDto,
} from '@smart-home-inventory/shared';
import { HaConfigEntry, HaDevice, HaEntity } from '../ha/ha-registry.types';

/**
 * Pure planning logic for auto-linking. No I/O: the service feeds it the HA
 * registry, the local device table, existing connections, rules and
 * suppressions, and gets back exactly what to create/update/remove.
 *
 * The one-controller-per-device model: each HA device gets at most one
 * managed link, keyed `ha:<haDeviceId>`. Changing its controller or
 * protocol is an update of that link, not a second link. Wired power,
 * plumbing and anything the user draws by hand are untouched.
 */

export interface LocalDevice {
  id: string;
  name: string;
  haDeviceId: string | null;
  category: string | null;
}

export interface ExistingConnection {
  id: string;
  type: string;
  fromDeviceId: string;
  toDeviceId: string;
  metadata: unknown;
}

export interface PlannerInput {
  localDevices: LocalDevice[];
  haDevices: HaDevice[];
  haEntities: HaEntity[];
  configEntries: HaConfigEntry[];
  /** connection type → controller local device id */
  rules: Record<string, string>;
  existing: ExistingConnection[];
  suppressedKeys: Set<string>;
  /** Connection types that, drawn by hand onto a device, mean "the user
   *  placed this device — leave it alone". Defaults to NETWORK_TYPES; the
   *  service widens it with 'other' and the user's own custom types. */
  overrideTypes?: ReadonlySet<string>;
}

export interface PlannerOutput {
  create: PlannedLinkDto[];
  update: PlannedLinkDto[];
  remove: PlannedLinkDto[];
  unchanged: number;
  skipped: SkippedDeviceDto[];
  controllerSuggestions: Record<string, ControllerCandidateDto[]>;
  unmappedPlatforms: string[];
}

/** Integration platform → connection type, when the platform alone is a
 *  confident protocol signal. */
const PLATFORM_TYPE: Record<string, ConnectionType> = {
  zha: 'zigbee_network',
  deconz: 'zigbee_network',
  hue: 'zigbee_network',
  zwave_js: 'zwave_network',
  matter: 'matter_fabric',
  // Local-network integrations: the device itself is on Wi-Fi/Ethernet.
  // We say "wifi" (the common case); the user can flip one to Ethernet.
  esphome: 'wifi',
  shelly: 'wifi',
  tasmota: 'wifi',
  tplink: 'wifi',
  wiz: 'wifi',
  yeelight: 'wifi',
  lifx: 'wifi',
  wled: 'wifi',
  nanoleaf: 'wifi',
  cast: 'wifi',
  apple_tv: 'wifi',
  sonos: 'wifi',
  roborock: 'wifi',
  roomba: 'wifi',
  roomba_plus: 'wifi',
  androidtv_remote: 'wifi',
  samsungtv: 'wifi',
  webostv: 'wifi',
  denonavr: 'wifi',
  onkyo: 'wifi',
  octoprint: 'wifi',
  plex: 'wifi',
  kodi: 'wifi',
  unifiprotect: 'wifi',
  reolink: 'wifi',
  amcrest: 'wifi',
  onvif: 'wifi',
  doorbird: 'wifi',
  tuya: 'wifi',
  localtuya: 'wifi',
  govee: 'wifi',
  meross: 'wifi',
  broadlink: 'wifi',
  elgato: 'wifi',
  daikin: 'wifi',
  ecobee: 'wifi',
  nest: 'wifi',
  rainbird: 'wifi',
  rachio: 'wifi',
  myq: 'wifi',
  ring: 'wifi',
  aarlo: 'wifi',
  arlo: 'wifi',
  ge_home: 'wifi',
  smarthq: 'wifi',
  smartthings: 'wifi',
  lg_thinq: 'wifi',
  samsungtv_smart: 'wifi',
  whirlpool: 'wifi',
  honeywell: 'wifi',
  lyric: 'wifi',
  airthings: 'wifi',
  awair: 'wifi',
  purpleair: 'wifi',
  wyze: 'wifi',
  blink: 'wifi',
  eufy: 'wifi',
  level: 'wifi',
  august: 'wifi',
  yale: 'wifi',
  schlage: 'wifi',
  alexa_media: 'wifi',
  sensibo: 'wifi',
  mitsubishi: 'wifi',
  fujitsu: 'wifi',
  rheem: 'wifi',
  econet: 'wifi',
  aquanta: 'wifi',
  flume: 'wifi',
  flo: 'wifi',
  moen: 'wifi',
  emporia_vue: 'wifi',
  sense: 'wifi',
  span_panel: 'wifi',
  enphase_envoy: 'wifi',
  tesla: 'wifi',
  wallbox: 'wifi',
  openevse: 'wifi',
  chargepoint: 'wifi',
  brother: 'wifi',
  hp: 'wifi',
  ipp: 'wifi',
  synology_dsm: 'ethernet',
  qnap: 'ethernet',
  unifi: 'wifi',
  omada: 'wifi',
  // Router integrations (netgear/unifi/asuswrt/fritz) create a device per
  // *client*; most home clients are wireless, so Wi-Fi is the better default
  // and the user can flip the wired ones.
  netgear: 'wifi',
  asuswrt: 'wifi',
  fritz: 'wifi',
  firewalla: 'ethernet',
  nut: 'ethernet',
  apcupsd: 'ethernet',
  proxmoxve: 'ethernet',
  pihole: 'ethernet',
  adguard: 'ethernet',
};

/** Platforms that never describe a radio/network path to a device — HA
 *  internals, cloud-only services, helpers. They don't count as "unknown". */
const IGNORED_PLATFORMS = new Set([
  'sun',
  'moon',
  'time_date',
  'template',
  'group',
  'input_boolean',
  'input_number',
  'input_select',
  'input_text',
  'input_datetime',
  'input_button',
  'counter',
  'timer',
  'schedule',
  'utility_meter',
  'integration',
  'derivative',
  'statistics',
  'min_max',
  'threshold',
  'trend',
  'history_stats',
  'mobile_app',
  'hassio',
  'homeassistant',
  'backup',
  'person',
  'zone',
  'weather',
  'met',
  'nws',
  'openweathermap',
  'accuweather',
  'forecast_solar',
  'tomorrowio',
  'blitzortung',
  'usgs_earthquakes_feed',
  'noaa_tides',
  'waze_travel_time',
  'google_travel_time',
  'calendar',
  'google',
  'caldav',
  'local_calendar',
  'local_todo',
  'shopping_list',
  'todo',
  'tts',
  'stt',
  'wyoming',
  'piper',
  'whisper',
  'openai_conversation',
  'ollama',
  'conversation',
  'assist_pipeline',
  'cloud',
  'nabu_casa',
  'script',
  'automation',
  'scene',
  'variable',
  'ping',
  'command_line',
  'file',
  'rest',
  'scrape',
  'feedreader',
  'rss_feed_template',
  'systemmonitor',
  'speedtestdotnet',
  'uptime',
  'version',
  'workday',
  'season',
  'holiday',
  'random',
  'demo',
  'home_organizer',
  'hacs',
  'ha_mcp_tools',
  'bluetooth',
  'bluetooth_le_tracker',
  'ibeacon',
  'alexa_devices',
  'cpuspeed',
  'upnp',
  'homeassistant_sky_connect',
  'homeassistant_connect_zbt1',
  'homeassistant_hardware',
  'jarvis',
  'localthings',
  'local_ip',
  'dlna_dmr',
  'dlna_dms',
  'otbr',
  'thread',
  'zigbee2mqtt',
]);

/** Types the planner owns. A *manual* connection of one of these types
 *  touching a device means "the user set this device's network link by
 *  hand" and the planner backs off. Power, plumbing, HDMI etc. never
 *  interfere. */
export const NETWORK_TYPES: ReadonlySet<string> = new Set([
  'wifi',
  'ethernet',
  'zigbee_network',
  'zigbee_binding',
  'zwave_network',
  'matter_fabric',
  'thread',
]);

export function autoKeyFor(haDeviceId: string): string {
  return `ha:${haDeviceId}`;
}

export function isManaged(metadata: unknown): metadata is AutoLinkMetadata {
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    (metadata as Record<string, unknown>)['auto'] === true &&
    typeof (metadata as Record<string, unknown>)['autoKey'] === 'string'
  );
}

/** What a via_device hub looks like, to classify MQTT-bridged devices whose
 *  own platform ("mqtt") says nothing about the radio. */
function hubType(hub: HaDevice, hubPlatforms: Set<string>): ConnectionType | null {
  const blob = [
    hub.name,
    hub.name_by_user,
    hub.manufacturer,
    hub.model,
    ...(hub.identifiers ?? []).flat(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/zigbee2mqtt|zigbee|z2m|coordinator|conbee|sonoff.*dongle|skyconnect|zbt-1/.test(blob))
    return 'zigbee_network';
  if (/zwave|z-wave|zwavejs|z-stick|zooz.*8\d\d|zst/.test(blob)) return 'zwave_network';
  if (/matter|thread|border router/.test(blob)) return 'matter_fabric';
  for (const p of hubPlatforms) {
    const t = PLATFORM_TYPE[p];
    if (t && t !== 'wifi' && t !== 'ethernet') return t;
  }
  if (/hue|bridge|hub|gateway|base station|basestation/.test(blob)) return 'other';
  return null;
}

function classify(
  platforms: Set<string>,
  hub: HaDevice | null,
  hubPlatforms: Set<string>
): { type: ConnectionType | null; unmapped: string[] } {
  // Strong, protocol-specific platforms win.
  for (const p of ['zha', 'deconz', 'zwave_js', 'matter', 'hue']) {
    if (platforms.has(p)) return { type: PLATFORM_TYPE[p], unmapped: [] };
  }
  // Behind a hub: the hub tells us the radio (Zigbee2MQTT bridge, zwave-js-ui…).
  if (hub) {
    const t = hubType(hub, hubPlatforms);
    if (t) return { type: t, unmapped: [] };
  }
  // Direct network integrations.
  const unmapped: string[] = [];
  let found: ConnectionType | null = null;
  for (const p of platforms) {
    if (IGNORED_PLATFORMS.has(p)) continue;
    const t = PLATFORM_TYPE[p];
    if (t) {
      if (!found) found = t;
    } else if (p !== 'mqtt') {
      unmapped.push(p);
    }
  }
  // Plain MQTT with no hub: could be anything (ESPHome-MQTT, Tasmota, a
  // bridge). Call it Wi-Fi only when nothing else is known — the user can
  // override, and it still needs a Wi-Fi rule to actually link.
  if (!found && platforms.has('mqtt') && !hub) found = 'wifi';
  // Behind a hub we couldn't classify: link anyway with 'other' so the
  // topology is right, and let the user retype it.
  if (!found && hub) found = 'other';
  return { type: found, unmapped };
}

export function plan(input: PlannerInput): PlannerOutput {
  const localByHa = new Map<string, LocalDevice>();
  const localById = new Map<string, LocalDevice>();
  for (const d of input.localDevices) {
    localById.set(d.id, d);
    if (d.haDeviceId) localByHa.set(d.haDeviceId, d);
  }
  const haById = new Map(input.haDevices.map((d) => [d.id, d]));
  const entryDomain = new Map(input.configEntries.map((e) => [e.entry_id, e.domain]));

  // platforms per HA device = entity platforms ∪ config-entry domains
  const platformsOf = new Map<string, Set<string>>();
  for (const d of input.haDevices) {
    const set = new Set<string>();
    for (const ce of d.config_entries ?? []) {
      const dom = entryDomain.get(ce);
      if (dom) set.add(dom);
    }
    platformsOf.set(d.id, set);
  }
  for (const e of input.haEntities) {
    if (!e.device_id) continue;
    let set = platformsOf.get(e.device_id);
    if (!set) {
      set = new Set();
      platformsOf.set(e.device_id, set);
    }
    set.add(e.platform);
  }

  // Controller suggestions: who is named as via_device, how often, by type.
  const childCounts = new Map<string, Map<string, number>>(); // type → (localId → n)
  const bump = (type: string, localId: string) => {
    let m = childCounts.get(type);
    if (!m) {
      m = new Map();
      childCounts.set(type, m);
    }
    m.set(localId, (m.get(localId) ?? 0) + 1);
  };

  const desired = new Map<string, PlannedLinkDto>();
  const skipped: SkippedDeviceDto[] = [];
  const unmappedAll = new Set<string>();

  for (const local of input.localDevices) {
    if (!local.haDeviceId) continue;
    const ha = haById.get(local.haDeviceId);
    if (!ha) continue; // orphaned in HA; nothing to derive
    // entry_type "service" = an integration's account/cloud entry
    // ("Aarlo for you@…", "Sun", "Forecast"): not hardware, nothing to link.
    if (ha.entry_type === 'service') continue;
    // Some integrations (aarlo, others) register the cloud account itself
    // as a plain device named "<Integration> for you@example.com".
    if (!ha.model && /\S+@\S+\.\S+/.test(`${ha.name ?? ''} ${ha.name_by_user ?? ''}`)) continue;
    const platforms = platformsOf.get(ha.id) ?? new Set<string>();
    const hub = ha.via_device_id ? (haById.get(ha.via_device_id) ?? null) : null;
    const hubPlatforms = hub ? (platformsOf.get(hub.id) ?? new Set<string>()) : new Set<string>();
    const { type, unmapped } = classify(platforms, hub, hubPlatforms);
    for (const u of unmapped) unmappedAll.add(u);
    const platformList = [...platforms].filter((p) => !IGNORED_PLATFORMS.has(p)).sort();

    if (!type) {
      skipped.push({
        deviceId: local.id,
        deviceName: local.name,
        reason: 'unknown_protocol',
        type: null,
        platforms: platformList,
      });
      continue;
    }

    // Resolve controller.
    let controller: LocalDevice | null = null;
    let reason: AutoLinkReason = 'via_device';
    if (hub) {
      controller = localByHa.get(hub.id) ?? null;
      if (controller) bump(type, controller.id);
    }
    if (!controller) {
      const ruleId = input.rules[type];
      controller = ruleId ? (localById.get(ruleId) ?? null) : null;
      reason = 'default_controller';
    }
    if (!controller) {
      skipped.push({
        deviceId: local.id,
        deviceName: local.name,
        reason: 'no_controller',
        type,
        platforms: platformList,
      });
      continue;
    }
    if (controller.id === local.id) {
      skipped.push({
        deviceId: local.id,
        deviceName: local.name,
        reason: 'self',
        type,
        platforms: platformList,
      });
      continue;
    }

    const autoKey = autoKeyFor(ha.id);
    if (input.suppressedKeys.has(autoKey)) {
      skipped.push({
        deviceId: local.id,
        deviceName: local.name,
        reason: 'suppressed',
        type,
        platforms: platformList,
      });
      continue;
    }
    // A hand-made link *into* this device (it's the downstream end) means
    // the user has placed it; that wins over anything we'd infer. Links
    // going *out* of it (a plug that controls a lamp, a base station that
    // feeds cameras) say nothing about its own upstream.
    const overrideTypes = input.overrideTypes ?? NETWORK_TYPES;
    const manualNetworkLink = input.existing.some(
      (c) => !isManaged(c.metadata) && overrideTypes.has(c.type) && c.toDeviceId === local.id
    );
    if (manualNetworkLink) {
      skipped.push({
        deviceId: local.id,
        deviceName: local.name,
        reason: 'manual_override',
        type,
        platforms: platformList,
      });
      continue;
    }

    desired.set(autoKey, {
      autoKey,
      type,
      fromDeviceId: controller.id,
      fromDeviceName: controller.name,
      toDeviceId: local.id,
      toDeviceName: local.name,
      reason,
      platforms: platformList,
    });
  }

  // Diff against existing managed links.
  const managedByKey = new Map<string, ExistingConnection>();
  for (const c of input.existing) {
    if (isManaged(c.metadata)) managedByKey.set(c.metadata.autoKey, c);
  }
  const create: PlannedLinkDto[] = [];
  const update: PlannedLinkDto[] = [];
  let unchanged = 0;
  for (const [key, want] of desired) {
    const have = managedByKey.get(key);
    if (!have) {
      create.push(want);
    } else if (
      have.type !== want.type ||
      have.fromDeviceId !== want.fromDeviceId ||
      have.toDeviceId !== want.toDeviceId
    ) {
      update.push({
        ...want,
        previous: {
          type: have.type as ConnectionType,
          fromDeviceId: have.fromDeviceId,
          fromDeviceName: localById.get(have.fromDeviceId)?.name ?? have.fromDeviceId,
        },
      });
    } else {
      unchanged++;
    }
  }
  const remove: PlannedLinkDto[] = [];
  for (const [key, have] of managedByKey) {
    if (desired.has(key)) continue;
    // Suppressed or overridden keys: the managed link is stale either way.
    remove.push({
      autoKey: key,
      type: have.type as ConnectionType,
      fromDeviceId: have.fromDeviceId,
      fromDeviceName: localById.get(have.fromDeviceId)?.name ?? have.fromDeviceId,
      toDeviceId: have.toDeviceId,
      toDeviceName: localById.get(have.toDeviceId)?.name ?? have.toDeviceId,
      reason: (have.metadata as AutoLinkMetadata).reason,
      platforms: (have.metadata as AutoLinkMetadata).platforms ?? [],
    });
  }

  // Suggestions: via_device hubs by type, then network-category devices for
  // wifi/ethernet when nothing else is known.
  const controllerSuggestions: Record<string, ControllerCandidateDto[]> = {};
  for (const [type, m] of childCounts) {
    controllerSuggestions[type] = [...m.entries()]
      .map(([deviceId, childCount]) => ({
        deviceId,
        deviceName: localById.get(deviceId)?.name ?? deviceId,
        childCount,
      }))
      .sort((a, b) => b.childCount - a.childCount);
  }
  const networkGear = input.localDevices
    .filter((d) => d.category === 'network')
    .map((d) => ({ deviceId: d.id, deviceName: d.name, childCount: 0 }));
  for (const t of ['wifi', 'ethernet']) {
    const existing = controllerSuggestions[t] ?? [];
    const ids = new Set(existing.map((c) => c.deviceId));
    controllerSuggestions[t] = [...existing, ...networkGear.filter((g) => !ids.has(g.deviceId))];
  }

  return {
    create,
    update,
    remove,
    unchanged,
    skipped,
    controllerSuggestions,
    unmappedPlatforms: [...unmappedAll].sort(),
  };
}
