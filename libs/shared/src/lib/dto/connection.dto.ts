import { z } from 'zod';
import { ConnectionType, ConnectionTypeSchema } from '../enums';

export interface ConnectionDto {
  id: string;
  type: ConnectionType;
  fromDeviceId: string;
  fromDeviceName: string;
  toDeviceId: string;
  toDeviceName: string;
  /** 'ha' = synced from Home Assistant (can be excluded), 'manual' = added by you. */
  fromDeviceSource: string;
  toDeviceSource: string;
  label: string | null;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export const CreateConnectionSchema = z
  .object({
    type: ConnectionTypeSchema,
    fromDeviceId: z.string().min(1),
    toDeviceId: z.string().min(1),
    label: z.string().max(200).nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
    notes: z.string().max(10000).nullish(),
  })
  .refine((c) => c.fromDeviceId !== c.toDeviceId, {
    message: 'a device cannot be connected to itself',
  });
export type CreateConnectionDto = z.infer<typeof CreateConnectionSchema>;

export const UpdateConnectionSchema = z.object({
  type: ConnectionTypeSchema.optional(),
  /** Re-point either end. Same-device is rejected server-side once both
   *  ends are resolved, since only one end may be sent. */
  fromDeviceId: z.string().min(1).optional(),
  toDeviceId: z.string().min(1).optional(),
  label: z.string().max(200).nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  notes: z.string().max(10000).nullish(),
});
export type UpdateConnectionDto = z.infer<typeof UpdateConnectionSchema>;

export const ConnectionQuerySchema = z.object({
  deviceId: z.string().optional(),
  areaId: z.string().optional(),
  type: ConnectionTypeSchema.optional(),
});
export type ConnectionQueryDto = z.infer<typeof ConnectionQuerySchema>;
