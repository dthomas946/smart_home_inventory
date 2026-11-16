import { HaMode } from '../enums';

export interface SyncCounts {
  created: number;
  updated: number;
  orphaned: number;
  unchanged: number;
}

export interface SyncResultDto {
  floors: SyncCounts;
  areas: SyncCounts;
  devices: SyncCounts;
  /** Non-physical HA devices skipped (built-in + user exclusion rules). */
  excluded?: { skipped: number; removed: number; kept: number };
  warnings: string[];
  syncedAt: string;
}

export interface HaStatusDto {
  mode: HaMode;
  connected: boolean;
  /** When true (the default), the app never sends write commands to HA. */
  readOnly: boolean;
  lastSyncAt: string | null;
  lastSyncResult: SyncResultDto | null;
}

/** Capability keys inferred from a device's HA entity registry (platform +
 *  device_class) — see HaCapabilitySuggestionsService. Purely informational. */
export interface HaCapabilitySuggestionDto {
  suggestedCapabilities: Array<{ key: string; label: string }>;
}

/** App defaults taken from Home Assistant's own configuration (Settings →
 *  System → General). Every field falls back when HA can't be reached. */
export interface HaLocaleDto {
  /** ISO 4217, e.g. "USD". */
  currency: string;
  /** ISO 3166-1 alpha-2, e.g. "US"; null when HA has none set. */
  country: string | null;
  language: string | null;
  timeZone: string | null;
  unitSystem: 'metric' | 'us_customary' | null;
  /** True when the values came from HA, false when they're fallbacks. */
  fromHa: boolean;
}
