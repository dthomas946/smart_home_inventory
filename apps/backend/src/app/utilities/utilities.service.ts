import { Injectable, NotFoundException } from '@nestjs/common';
import { UtilityProvider } from '@smart-home-inventory/prisma';
import {
  CreateUtilityProviderDto,
  isUtilityKind,
  UpdateUtilityProviderDto,
  UTILITY_KINDS,
  UtilityProviderDto,
  UtilityProviderSchema,
  UpdateUtilityProviderSchema,
  UtilitySummaryDto,
} from '@smart-home-inventory/shared';
import { PrismaService } from '../prisma/prisma.service';

function toDto(p: UtilityProvider): UtilityProviderDto {
  return {
    id: p.id,
    utility: isUtilityKind(p.utility) ? p.utility : 'electrical',
    name: p.name,
    accountNumber: p.accountNumber,
    phone: p.phone,
    emergencyPhone: p.emergencyPhone,
    email: p.email,
    website: p.website,
    outageUrl: p.outageUrl,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class UtilitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every utility with its providers, map types, connection count and plans. */
  async summaries(): Promise<UtilitySummaryDto[]> {
    const [providers, types, diagrams] = await Promise.all([
      this.prisma.utilityProvider.findMany({ orderBy: [{ utility: 'asc' }, { name: 'asc' }] }),
      this.prisma.connectionType.findMany({ where: { utility: { not: null } }, select: { key: true, utility: true } }),
      this.prisma.diagram.findMany({
        where: { utility: { not: null } },
        select: { id: true, title: true, utility: true, updatedAt: true },
        orderBy: { title: 'asc' },
      }),
    ]);
    const counts = await this.prisma.connection.groupBy({ by: ['type'], _count: { _all: true } });
    const countByType = new Map(counts.map((c) => [c.type, c._count._all]));
    return UTILITY_KINDS.map((utility) => {
      const keys = types.filter((t) => t.utility === utility).map((t) => t.key);
      return {
        utility,
        providers: providers.filter((p) => p.utility === utility).map(toDto),
        connectionTypes: keys,
        connectionCount: keys.reduce((n, k) => n + (countByType.get(k) ?? 0), 0),
        diagrams: diagrams
          .filter((d) => d.utility === utility)
          .map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt.toISOString() })),
      };
    });
  }

  async create(input: CreateUtilityProviderDto): Promise<UtilityProviderDto> {
    const dto = UtilityProviderSchema.parse(input);
    return toDto(await this.prisma.utilityProvider.create({ data: dto }));
  }

  async update(id: string, input: UpdateUtilityProviderDto): Promise<UtilityProviderDto> {
    await this.getOrThrow(id);
    const dto = UpdateUtilityProviderSchema.parse(input);
    // Only touch fields that were sent (partial() keeps absent keys absent,
    // but the nullish→null transform would turn them into null).
    const data = Object.fromEntries(
      Object.entries(dto).filter(([k]) => Object.prototype.hasOwnProperty.call(input, k))
    );
    return toDto(await this.prisma.utilityProvider.update({ where: { id }, data }));
  }

  async remove(id: string): Promise<void> {
    await this.getOrThrow(id);
    await this.prisma.utilityProvider.delete({ where: { id } });
  }

  private async getOrThrow(id: string): Promise<UtilityProvider> {
    const p = await this.prisma.utilityProvider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException(`Provider ${id} not found`);
    return p;
  }
}
