import { z } from 'zod';
import {
  DeviceCategory,
  DeviceCategorySchema,
  DeviceStatus,
  DeviceStatusSchema,
  EntitySource,
  EntitySourceSchema,
} from '../enums';
import { AttachmentDto } from './attachment.dto';
import { DeviceCapabilityDto } from './capability.dto';
import { ConnectionDto } from './connection.dto';

export interface DuplicateHintDto {
  id: string;
  name: string;
  integrations: string[];
  /** 'mac' = shares a MAC address (near-certain); 'name' = same name, different integration (likely). */
  reason: 'mac' | 'name';
}

export interface DeviceDto {
  id: string;
  name: string;
  category: DeviceCategory | null;
  manufacturer: string | null;
  /** Brand as sold (Frigidaire) when it differs from the manufacturer on the plate (Electrolux). */
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchasePriceCents: number | null;
  purchaseCurrency: string | null;
  purchasedFrom: string | null;
  productUrl: string | null;
  notes: string | null;
  status: DeviceStatus;
  areaId: string | null;
  areaName: string | null;
  haDeviceId: string | null;
  haOrphaned: boolean;
  source: EntitySource;
  primaryImageId: string | null;
  capabilityKeys: string[];
  /** Number of attachments of kind `manual` — lets lists show "has docs" without loading attachments. */
  manualCount: number;
  /** HA integration domains (zha, netgear, esphome…); empty for devices you added yourself. */
  integrations: string[];
  /** Other devices that look like the same hardware (shared MAC, or same name in another integration). */
  duplicates: DuplicateHintDto[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceDetailDto extends DeviceDto {
  capabilities: DeviceCapabilityDto[];
  attachments: AttachmentDto[];
  connections: ConnectionDto[];
}

export const CreateDeviceSchema = z.object({
  name: z.string().min(1).max(200),
  category: DeviceCategorySchema.nullish(),
  manufacturer: z.string().max(200).nullish(),
  brand: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  serialNumber: z.string().max(200).nullish(),
  purchaseDate: z.iso.datetime().nullish(),
  purchasePriceCents: z.number().int().nonnegative().nullish(),
  purchaseCurrency: z.string().length(3).nullish(),
  purchasedFrom: z.string().max(200).nullish(),
  productUrl: z.url().max(2000).nullish(),
  notes: z.string().max(10000).nullish(),
  status: DeviceStatusSchema.default('installed'),
  areaId: z.string().nullish(),
  haDeviceId: z.string().nullish(),
});
export type CreateDeviceDto = z.infer<typeof CreateDeviceSchema>;

export const UpdateDeviceSchema = CreateDeviceSchema.partial();
export type UpdateDeviceDto = z.infer<typeof UpdateDeviceSchema>;

export const DeviceQuerySchema = z.object({
  q: z.string().optional(),
  areaId: z.string().optional(),
  status: DeviceStatusSchema.optional(),
  category: DeviceCategorySchema.optional(),
  capability: z.string().optional(),
  /** `manual` = equipment you entered yourself; `ha` = synced from Home Assistant. */
  source: EntitySourceSchema.optional(),
  /** Only devices from this HA integration domain. */
  integration: z.string().max(100).optional(),
  /** Only devices with a duplicate hint. */
  duplicates: z.enum(['1', 'true']).optional(),
});
export type DeviceQueryDto = z.infer<typeof DeviceQuerySchema>;

export const SetPrimaryImageSchema = z.object({
  attachmentId: z.string().nullable(),
});
export type SetPrimaryImageDto = z.infer<typeof SetPrimaryImageSchema>;
