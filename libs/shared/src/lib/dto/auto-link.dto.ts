import { CircuitDto, UtilityKind } from './utility.dto';
import { z } from 'zod';
import { ConnectionType, ConnectionTypeSchema } from '../enums';

/**
 * Auto-linking: derive "device → its controller" connections from Home
 * Assistant's own registry (via_device + integration platform), with the
 * user able to override any link and re-run at will.
 *
 * Vocabulary:
 * - managed connection: one the planner created; carries
 *   `metadata.auto === true` and `metadata.autoKey`.
 * - rule: default controller for a connection type, used when HA has no
 *   via_device for a device (Wi-Fi gear → the router).
 * - suppression: an autoKey the user deleted or converted to manual; the
 *   planner never recreates it until suppressions are reset.
 */

/** Marker stored in Connection.metadata for planner-managed links. */
export interface AutoLinkMetadata {
  auto: true;
  autoKey: string;
  reason: AutoLinkReason;
  /** HA integration platform(s) that drove the classification. */
  platforms: string[];
}

export type AutoLinkReason = 'via_device' | 'default_controller';

export type AutoLinkSkipReason =
  | 'manual_override'
  | 'suppressed'
  | 'no_controller'
  | 'unknown_protocol'
  | 'self';

export interface AutoLinkRuleDto {
  type: ConnectionType;
  controllerDeviceId: string;
  controllerDeviceName: string;
}

export const SetAutoLinkRulesSchema = z.object({
  rules: z.array(
    z.object({
      type: ConnectionTypeSchema,
      /** null clears the rule for that type. */
      controllerDeviceId: z.string().nullable(),
    })
  ),
});
export type SetAutoLinkRulesDto = z.infer<typeof SetAutoLinkRulesSchema>;

export interface PlannedLinkDto {
  autoKey: string;
  type: ConnectionType;
  /** Controller / upstream end. */
  fromDeviceId: string;
  fromDeviceName: string;
  /** The device being linked. */
  toDeviceId: string;
  toDeviceName: string;
  reason: AutoLinkReason;
  platforms: string[];
  /** For updates: what the existing managed link currently points at. */
  previous?: { type: ConnectionType; fromDeviceId: string; fromDeviceName: string };
}

export interface SkippedDeviceDto {
  deviceId: string;
  deviceName: string;
  reason: AutoLinkSkipReason;
  /** Protocol we inferred (if any) — tells you which rule would unblock it. */
  type: ConnectionType | null;
  platforms: string[];
}

export interface ControllerCandidateDto {
  deviceId: string;
  deviceName: string;
  /** How many HA devices name this one as their via_device. */
  childCount: number;
}

export interface AutoLinkPlanDto {
  create: PlannedLinkDto[];
  update: PlannedLinkDto[];
  remove: PlannedLinkDto[];
  unchanged: number;
  skipped: SkippedDeviceDto[];
  /** Per connection type, devices that look like controllers for it. */
  controllerSuggestions: Record<string, ControllerCandidateDto[]>;
  rules: AutoLinkRuleDto[];
  suppressedCount: number;
  /** Platforms seen on HA devices that the planner has no mapping for. */
  unmappedPlatforms: string[];
  generatedAt: string;
}

export interface AutoLinkApplyResultDto {
  created: number;
  updated: number;
  removed: number;
  at: string;
}

export interface AutoLinkStatusDto {
  lastRunAt: string | null;
  lastResult: AutoLinkApplyResultDto | null;
  managedCount: number;
  suppressedCount: number;
  rules: AutoLinkRuleDto[];
}

/** Network map layout modes and saved hand-arranged positions. */
export const NETWORK_LAYOUT_MODES = ['hierarchy', 'radial'] as const;
export const NetworkLayoutModeSchema = z.enum(NETWORK_LAYOUT_MODES);
export type NetworkLayoutMode = z.infer<typeof NetworkLayoutModeSchema>;

/** Saved-positions key: a layout mode, optionally for one utility's map
 *  ("hierarchy", "radial:electrical"). */
export const NetworkLayoutKeySchema = z
  .string()
  .regex(/^(hierarchy|radial)(:(electrical|gas|water|phone|internet|solar))?(:actual)?$/);

export const NetworkPositionsSchema = z.record(
  z.string(),
  z.object({ x: z.number().finite(), y: z.number().finite() })
);
export type NetworkPositions = z.infer<typeof NetworkPositionsSchema>;

export const SaveNetworkLayoutSchema = z.object({ positions: NetworkPositionsSchema });
export type SaveNetworkLayoutDto = z.infer<typeof SaveNetworkLayoutSchema>;

export interface NetworkLayoutDto {
  mode: string;
  positions: NetworkPositions;
  updatedAt: string | null;
}

/** Network graph for the visualization page. */
export interface NetworkGraphNodeDto {
  id: string;
  name: string;
  category: string | null;
  areaName: string | null;
  brand: string | null;
  manufacturer: string | null;
  model: string | null;
  source: 'manual' | 'ha';
  /** True when at least one connection has this device as its `from` end. */
  isController: boolean;
}

export interface NetworkGraphEdgeDto {
  id: string;
  type: ConnectionType;
  fromDeviceId: string;
  toDeviceId: string;
  auto: boolean;
  label: string | null;
  /** Breaker / amps / area served, when this is an electrical circuit. */
  circuit?: CircuitDto | null;
  /** Actual-routes view only: measured link quality and its readout. */
  quality?: 'good' | 'fair' | 'poor' | null;
  signal?: string | null;
}

export interface NetworkGraphDto {
  nodes: NetworkGraphNodeDto[];
  edges: NetworkGraphEdgeDto[];
  types: Array<{ key: string; label: string; color: string; dash: string; group: string; utility: UtilityKind | null }>;
}

// ---------------------------------------------------------------------------
// Actual mesh routes (Network map → Routes: Actual)
// ---------------------------------------------------------------------------

export type MeshProtocolKey = 'zigbee' | 'zwave' | 'thread';
export type LinkQuality = 'good' | 'fair' | 'poor';

export interface MeshHopDto {
  protocol: MeshProtocolKey;
  /** Inventory device ids. parentId null = straight to its controller. */
  deviceId: string;
  parentId: string | null;
  lqi: number | null;
  rssi: number | null;
  quality: LinkQuality | null;
  /** Next hop that isn't in the inventory (e.g. an Apple Thread router). */
  viaUnknown?: string | null;
}

export interface WifiLinkDto {
  deviceId: string;
  /** "5GHz", "2.4GHz", "2.4GHz - IoT", "wired"… as the router reports it. */
  band: string | null;
  /** Router-reported signal, 0–100 %. */
  signal: number | null;
  quality: LinkQuality | null;
}

export interface MeshSourceStatusDto {
  status: 'ok' | 'unavailable' | 'error';
  devices: number;
  message?: string;
}

export interface MeshSnapshotDto {
  fetchedAt: string;
  hops: MeshHopDto[];
  wifi: WifiLinkDto[];
  sources: Record<MeshProtocolKey | 'wifi', MeshSourceStatusDto>;
}
