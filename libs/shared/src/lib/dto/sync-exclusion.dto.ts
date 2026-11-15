import { z } from 'zod';

/**
 * Keeping virtual "devices" out of the inventory. Home Assistant registers
 * plenty of things as devices that aren't hardware — an add-on's MQTT feeds
 * (Downdetector per company), add-ons themselves, weather and system
 * monitors, cloud accounts. Built-in rules catch the obvious ones; users add
 * their own by manufacturer, integration, or single device.
 */
export const SYNC_EXCLUSION_KINDS = ['manufacturer', 'integration', 'device'] as const;
export const SyncExclusionKindSchema = z.enum(SYNC_EXCLUSION_KINDS);
export type SyncExclusionKind = z.infer<typeof SyncExclusionKindSchema>;

export const CreateSyncExclusionSchema = z.object({
  kind: SyncExclusionKindSchema,
  value: z.string().trim().min(1).max(300),
  /** Display text for device rules (the device's name at the time). */
  label: z.string().max(300).nullish(),
});
export type CreateSyncExclusionDto = z.infer<typeof CreateSyncExclusionSchema>;

export interface SyncExclusionDto {
  id: string;
  kind: SyncExclusionKind;
  value: string;
  label: string | null;
  /** How many HA devices this rule currently matches. */
  matchCount: number;
}

export interface ExcludedDeviceDto {
  haDeviceId: string;
  name: string;
  manufacturer: string | null;
  integrations: string[];
  /** Human-readable: "manufacturer: Downdetector", "virtual: hassio", … */
  reason: string;
  /** Local copy still in the inventory because it holds user data. */
  keptLocalId: string | null;
  keptBecause: string | null;
}

export interface SyncExclusionsDto {
  rules: SyncExclusionDto[];
  excluded: ExcludedDeviceDto[];
  /** Integration domains treated as virtual out of the box. */
  builtInVirtualIntegrations: string[];
  /** For the "add rule" pickers: what's present in HA right now. */
  knownManufacturers: string[];
  knownIntegrations: string[];
}
