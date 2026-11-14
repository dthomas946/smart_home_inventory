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
}

export interface NetworkGraphDto {
  nodes: NetworkGraphNodeDto[];
  edges: NetworkGraphEdgeDto[];
  types: Array<{ key: string; label: string; color: string; dash: string; group: string }>;
}
