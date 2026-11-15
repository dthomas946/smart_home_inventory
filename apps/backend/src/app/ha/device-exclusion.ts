import { HaConfigEntry, HaDevice } from './ha-registry.types';

/**
 * Which Home Assistant registry devices are *not* physical hardware.
 * Pure: the sync service and the exclusions preview both call this.
 */

/** Integrations whose devices are never hardware you could hold. A device
 *  is treated as virtual only when *every* integration it belongs to is in
 *  this set — a Shelly that also has a template helper attached stays. */
export const BUILT_IN_VIRTUAL_INTEGRATIONS: readonly string[] = [
  'hassio', // add-ons / apps, Supervisor, Core, OS
  'homeassistant',
  'backup',
  'sun',
  'moon',
  'season',
  'workday',
  'holiday',
  'time_date',
  'met',
  'nws',
  'openweathermap',
  'accuweather',
  'tomorrowio',
  'pirateweather',
  'forecast_solar',
  'blitzortung',
  'usgs_earthquakes_feed',
  'noaa_tides',
  'systemmonitor',
  'cpuspeed',
  'speedtestdotnet',
  'fastdotcom',
  'uptime',
  'version',
  'google',
  'caldav',
  'local_calendar',
  'local_todo',
  'shopping_list',
  'todoist',
  'template',
  'group',
  'utility_meter',
  'integration',
  'derivative',
  'statistics',
  'min_max',
  'threshold',
  'trend',
  'history_stats',
  'filter',
  'random',
  'counter',
  'timer',
  'schedule',
  'variable',
  'waze_travel_time',
  'google_travel_time',
  'openai_conversation',
  'anthropic',
  'google_generative_ai_conversation',
  'ollama',
  'extended_openai_conversation',
  'feedreader',
  'scrape',
  'rest',
  'command_line',
  'hacs',
  'ha_mcp_tools',
  'home_organizer',
  'radio_browser',
  'tts',
  'cloud',
  'met_eireann',
  'ipp_cloud',
  'downdetector',
  'downdetector_spike_monitor',
];

export interface ExclusionRules {
  manufacturers: string[];
  integrations: string[];
  deviceIds: string[];
}

export function integrationsOf(device: HaDevice, configEntries: HaConfigEntry[]): string[] {
  const byId = new Map(configEntries.map((e) => [e.entry_id, e.domain]));
  const out = new Set<string>();
  for (const id of device.config_entries ?? []) {
    const d = byId.get(id);
    if (d) out.add(d);
  }
  return [...out].sort();
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Reason this device is excluded, or null when it belongs in the inventory. */
export function exclusionReason(
  device: HaDevice,
  integrations: string[],
  rules: ExclusionRules
): string | null {
  if (device.entry_type === 'service') return 'service entry';
  if (rules.deviceIds.includes(device.id)) return 'excluded by you';

  const mfr = norm(device.manufacturer);
  if (mfr && rules.manufacturers.some((m) => norm(m) === mfr)) {
    return `manufacturer: ${device.manufacturer}`;
  }
  const userIntegration = integrations.find((d) => rules.integrations.some((r) => norm(r) === d));
  if (userIntegration) return `integration: ${userIntegration}`;

  if (integrations.length > 0 && integrations.every((d) => BUILT_IN_VIRTUAL_INTEGRATIONS.includes(d))) {
    return `virtual: ${integrations.join(', ')}`;
  }
  // Cloud accounts registered as a device ("Aarlo for you@example.com").
  if (!device.model && /\S+@\S+\.\S+/.test(`${device.name ?? ''} ${device.name_by_user ?? ''}`)) {
    return 'cloud account';
  }
  return null;
}
