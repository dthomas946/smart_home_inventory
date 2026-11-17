import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@smart-home-inventory/prisma';
import {
  CreateDeviceDto,
  DeviceCategory,
  DeviceDetailDto,
  DeviceDto,
  DuplicateHintDto,
  DeviceQueryDto,
  DeviceStatus,
  EntitySource,
  UpdateDeviceDto,
} from '@smart-home-inventory/shared';
import { PrismaService } from '../prisma/prisma.service';
import { FALLBACK_CURRENCY, HaLocaleService } from '../ha/ha-locale.service';
import { computeDuplicates } from './device-duplicates';
import {
  toAttachmentDto,
  toConnectionDto,
  toDeviceCapabilityDto,
} from '../common/mappers';

const listInclude = {
  area: { select: { name: true } },
  capabilities: { include: { capabilityType: true } },
  _count: { select: { attachments: { where: { kind: 'manual' } } } },
} satisfies Prisma.DeviceInclude;

const detailInclude = {
  ...listInclude,
  attachments: { orderBy: { createdAt: 'desc' as const } },
  connectionsFrom: {
    include: {
      fromDevice: { select: { name: true, source: true } },
      toDevice: { select: { name: true, source: true } },
    },
  },
  connectionsTo: {
    include: {
      fromDevice: { select: { name: true, source: true } },
      toDevice: { select: { name: true, source: true } },
    },
  },
} satisfies Prisma.DeviceInclude;

type DeviceForList = Prisma.DeviceGetPayload<{ include: typeof listInclude }>;
type DeviceForDetail = Prisma.DeviceGetPayload<{ include: typeof detailInclude }>;

export function toDeviceDto(
  d: DeviceForList,
  duplicates: Map<string, DuplicateHintDto[]> = new Map()
): DeviceDto {
  return {
    id: d.id,
    name: d.name,
    category: d.category as DeviceCategory | null,
    manufacturer: d.manufacturer,
    brand: d.brand,
    model: d.model,
    serialNumber: d.serialNumber,
    purchaseDate: d.purchaseDate?.toISOString() ?? null,
    purchasePriceCents: d.purchasePriceCents,
    purchaseCurrency: d.purchaseCurrency,
    purchasedFrom: d.purchasedFrom,
    productUrl: d.productUrl,
    notes: d.notes,
    status: d.status as DeviceStatus,
    areaId: d.areaId,
    areaName: d.area?.name ?? null,
    haDeviceId: d.haDeviceId,
    haOrphaned: d.haOrphaned,
    source: d.source as EntitySource,
    primaryImageId: d.primaryImageId,
    capabilityKeys: d.capabilities.map((c) => c.capabilityType.key),
    manualCount: d._count.attachments,
    integrations: d.haIntegrations ? d.haIntegrations.split(',').filter(Boolean) : [],
    duplicates: duplicates.get(d.id) ?? [],
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function toDeviceDetailDto(
  d: DeviceForDetail,
  duplicates: Map<string, DuplicateHintDto[]> = new Map()
): DeviceDetailDto {
  return {
    ...toDeviceDto(d, duplicates),
    capabilities: d.capabilities.map(toDeviceCapabilityDto),
    attachments: d.attachments.map(toAttachmentDto),
    connections: [...d.connectionsFrom, ...d.connectionsTo].map(toConnectionDto),
  };
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locale: HaLocaleService
  ) {}

  /** Duplicate hints across the whole table — small enough to compute per request. */
  private async duplicatesMap(): Promise<Map<string, DuplicateHintDto[]>> {
    const all = await this.prisma.device.findMany({
      select: { id: true, name: true, haIntegrations: true, haMacs: true, source: true },
    });
    return computeDuplicates(all);
  }

  async list(query: DeviceQueryDto): Promise<DeviceDto[]> {
    const devices = await this.prisma.device.findMany({
      where: {
        ...(query.areaId ? { areaId: query.areaId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.source ? { source: query.source } : {}),
        ...(query.integration ? { haIntegrations: { contains: query.integration } } : {}),
        ...(query.connectionType
          ? {
              AND: [
                {
                  OR: [
                    { connectionsFrom: { some: { type: query.connectionType } } },
                    { connectionsTo: { some: { type: query.connectionType } } },
                  ],
                },
              ],
            }
          : {}),
        ...(query.capability
          ? { capabilities: { some: { capabilityType: { key: query.capability } } } }
          : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q } },
                { manufacturer: { contains: query.q } },
                { brand: { contains: query.q } },
                { model: { contains: query.q } },
                { serialNumber: { contains: query.q } },
              ],
            }
          : {}),
      },
      include: listInclude,
      orderBy: { name: 'asc' },
    });
    const dupes = await this.duplicatesMap();
    const integration = query.integration?.toLowerCase();
    return devices
      .map((d) => toDeviceDto(d, dupes))
      .filter((d) => !integration || d.integrations.includes(integration))
      .filter((d) => !query.duplicates || d.duplicates.length > 0);
  }

  async get(id: string): Promise<DeviceDetailDto> {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!device) throw new NotFoundException(`Device ${id} not found`);
    return toDeviceDetailDto(device, await this.duplicatesMap());
  }

  async create(dto: CreateDeviceDto): Promise<DeviceDetailDto> {
    await this.validateAreaRef(dto.areaId);
    const currency = dto.purchaseCurrency ?? (await this.locale.currency());
    const device = await this.prisma.device.create({
      data: { ...this.toWriteData(dto), purchaseCurrency: currency },
      include: detailInclude,
    });
    return toDeviceDetailDto(device, await this.duplicatesMap());
  }

  async update(id: string, dto: UpdateDeviceDto): Promise<DeviceDetailDto> {
    await this.ensureExists(id);
    if (dto.areaId !== undefined) await this.validateAreaRef(dto.areaId);
    const data: Prisma.DeviceUpdateInput = {};
    const fields: (keyof UpdateDeviceDto)[] = [
      'name',
      'category',
      'manufacturer',
      'brand',
      'model',
      'serialNumber',
      'purchasePriceCents',
      'purchaseCurrency',
      'purchasedFrom',
      'productUrl',
      'notes',
      'status',
      'haDeviceId',
    ];
    for (const f of fields) {
      if (dto[f] !== undefined) {
        (data as Record<string, unknown>)[f] = dto[f];
      }
    }
    if (dto.purchaseDate !== undefined) {
      data.purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : null;
    }
    if (dto.areaId !== undefined) {
      data.area = dto.areaId ? { connect: { id: dto.areaId } } : { disconnect: true };
    }
    const device = await this.prisma.device.update({
      where: { id },
      data,
      include: detailInclude,
    });
    return toDeviceDetailDto(device, await this.duplicatesMap());
  }

  async setPrimaryImage(id: string, attachmentId: string | null): Promise<DeviceDetailDto> {
    await this.ensureExists(id);
    if (attachmentId) {
      const attachment = await this.prisma.attachment.findUnique({
        where: { id: attachmentId },
      });
      if (!attachment || attachment.deviceId !== id) {
        throw new BadRequestException(
          'attachment must exist and belong to this device'
        );
      }
      if (!attachment.mimeType.startsWith('image/')) {
        throw new BadRequestException('primary image must be an image attachment');
      }
    }
    const device = await this.prisma.device.update({
      where: { id },
      data: { primaryImageId: attachmentId },
      include: detailInclude,
    });
    return toDeviceDetailDto(device, await this.duplicatesMap());
  }

  async remove(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.device.delete({ where: { id } });
  }

  private toWriteData(dto: CreateDeviceDto): Prisma.DeviceCreateInput {
    return {
      name: dto.name,
      category: dto.category ?? null,
      manufacturer: dto.manufacturer ?? null,
      brand: dto.brand ?? null,
      model: dto.model ?? null,
      serialNumber: dto.serialNumber ?? null,
      purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : null,
      purchasePriceCents: dto.purchasePriceCents ?? null,
      purchaseCurrency: dto.purchaseCurrency ?? FALLBACK_CURRENCY,
      purchasedFrom: dto.purchasedFrom ?? null,
      productUrl: dto.productUrl ?? null,
      notes: dto.notes ?? null,
      status: dto.status,
      haDeviceId: dto.haDeviceId ?? null,
      ...(dto.areaId ? { area: { connect: { id: dto.areaId } } } : {}),
    };
  }

  private async validateAreaRef(areaId: string | null | undefined): Promise<void> {
    if (!areaId) return;
    const area = await this.prisma.area.findUnique({
      where: { id: areaId },
      select: { id: true },
    });
    if (!area) throw new BadRequestException(`Area ${areaId} does not exist`);
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.device.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`Device ${id} not found`);
  }
}
