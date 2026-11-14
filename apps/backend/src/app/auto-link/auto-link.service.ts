import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@smart-home-inventory/prisma';
import {
  AutoLinkApplyResultDto,
  AutoLinkMetadata,
  AutoLinkPlanDto,
  AutoLinkRuleDto,
  AutoLinkStatusDto,
  NetworkGraphDto,
  SetAutoLinkRulesDto,
} from '@smart-home-inventory/shared';
import { ConnectionTypesService } from '../connection-types/connection-types.service';
import {
  HA_REGISTRY_CLIENT,
  HaConfigEntry,
  HaDevice,
  HaEntity,
  HaRegistryClient,
} from '../ha/ha-registry.types';
import { PrismaService } from '../prisma/prisma.service';
import { isManaged, plan, PlannerInput, PlannerOutput } from './auto-link.planner';

@Injectable()
export class AutoLinkService {
  private readonly logger = new Logger(AutoLinkService.name);
  private lastRunAt: Date | null = null;
  private lastResult: AutoLinkApplyResultDto | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectionTypes: ConnectionTypesService,
    @Inject(HA_REGISTRY_CLIENT) private readonly client: HaRegistryClient
  ) {}

  async status(): Promise<AutoLinkStatusDto> {
    const [managedCount, suppressedCount, rules] = await Promise.all([
      this.countManaged(),
      this.prisma.autoLinkSuppression.count(),
      this.listRules(),
    ]);
    return {
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      lastResult: this.lastResult,
      managedCount,
      suppressedCount,
      rules,
    };
  }

  async listRules(): Promise<AutoLinkRuleDto[]> {
    const rows = await this.prisma.autoLinkRule.findMany({
      include: { controller: { select: { name: true } } },
      orderBy: { type: 'asc' },
    });
    return rows.map((r) => ({
      type: r.type as AutoLinkRuleDto['type'],
      controllerDeviceId: r.controllerDeviceId,
      controllerDeviceName: r.controller.name,
    }));
  }

  async setRules(dto: SetAutoLinkRulesDto): Promise<AutoLinkRuleDto[]> {
    for (const rule of dto.rules) {
      await this.connectionTypes.ensureKeyExists(rule.type);
      if (rule.controllerDeviceId === null) {
        await this.prisma.autoLinkRule.deleteMany({ where: { type: rule.type } });
        continue;
      }
      const exists = await this.prisma.device.findUnique({
        where: { id: rule.controllerDeviceId },
        select: { id: true },
      });
      if (!exists) throw new BadRequestException(`Device ${rule.controllerDeviceId} does not exist`);
      await this.prisma.autoLinkRule.upsert({
        where: { type: rule.type },
        create: { type: rule.type, controllerDeviceId: rule.controllerDeviceId },
        update: { controllerDeviceId: rule.controllerDeviceId },
      });
    }
    return this.listRules();
  }

  /** Forget every user override so the next run may recreate those links. */
  async resetSuppressions(): Promise<{ cleared: number }> {
    const { count } = await this.prisma.autoLinkSuppression.deleteMany({});
    return { cleared: count };
  }

  /** Escape hatch: delete every planner-created link (manual ones untouched).
   *  Does not add suppressions — a later Apply recreates them. */
  async removeAllManaged(): Promise<{ removed: number }> {
    const rows = await this.prisma.connection.findMany({ select: { id: true, metadata: true } });
    const ids = rows.filter((r) => isManaged(r.metadata)).map((r) => r.id);
    if (ids.length === 0) return { removed: 0 };
    const { count } = await this.prisma.connection.deleteMany({ where: { id: { in: ids } } });
    this.logger.log(`Removed ${count} auto links`);
    return { removed: count };
  }

  /** Record that the user deleted/converted a managed link. Called by
   *  ConnectionsService so overrides are captured wherever they happen. */
  async suppress(autoKey: string, reason: string): Promise<void> {
    await this.prisma.autoLinkSuppression.upsert({
      where: { autoKey },
      create: { autoKey, reason },
      update: { reason },
    });
  }

  async plan(): Promise<AutoLinkPlanDto> {
    const { output, rules, suppressedCount } = await this.computePlan();
    return {
      ...output,
      rules,
      suppressedCount,
      generatedAt: new Date().toISOString(),
    };
  }

  async apply(): Promise<AutoLinkApplyResultDto> {
    const { output, managedIdByKey } = await this.computePlan();
    let created = 0;
    let updated = 0;
    let removed = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const link of output.create) {
        await tx.connection.create({
          data: {
            type: link.type,
            fromDeviceId: link.fromDeviceId,
            toDeviceId: link.toDeviceId,
            metadata: metadataFor(link) as unknown as Prisma.InputJsonValue,
          },
        });
        created++;
      }
      for (const link of output.update) {
        const id = managedIdByKey.get(link.autoKey);
        if (!id) continue;
        await tx.connection.update({
          where: { id },
          data: {
            type: link.type,
            fromDeviceId: link.fromDeviceId,
            toDeviceId: link.toDeviceId,
            metadata: metadataFor(link) as unknown as Prisma.InputJsonValue,
          },
        });
        updated++;
      }
      for (const link of output.remove) {
        const id = managedIdByKey.get(link.autoKey);
        if (!id) continue;
        await tx.connection.delete({ where: { id } });
        removed++;
      }
    });

    this.lastRunAt = new Date();
    this.lastResult = { created, updated, removed, at: this.lastRunAt.toISOString() };
    this.logger.log(`Auto-link applied: +${created} ~${updated} -${removed}`);
    return this.lastResult;
  }

  /** Everything the Network page needs in one call. */
  async graph(): Promise<NetworkGraphDto> {
    const [devices, connections, types] = await Promise.all([
      this.prisma.device.findMany({
        select: {
          id: true,
          name: true,
          category: true,
          brand: true,
          manufacturer: true,
          model: true,
          source: true,
          area: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.connection.findMany({
        select: {
          id: true,
          type: true,
          fromDeviceId: true,
          toDeviceId: true,
          label: true,
          metadata: true,
        },
      }),
      this.connectionTypes.list(),
    ]);
    const controllers = new Set(connections.map((c) => c.fromDeviceId));
    return {
      nodes: devices.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        areaName: d.area?.name ?? null,
        brand: d.brand,
        manufacturer: d.manufacturer,
        model: d.model,
        source: d.source as 'manual' | 'ha',
        isController: controllers.has(d.id),
      })),
      edges: connections.map((c) => ({
        id: c.id,
        type: c.type as NetworkGraphDto['edges'][number]['type'],
        fromDeviceId: c.fromDeviceId,
        toDeviceId: c.toDeviceId,
        auto: isManaged(c.metadata),
        label: c.label,
      })),
      types: types.map((t) => ({
        key: t.key,
        label: t.label,
        color: t.color,
        dash: t.dash,
        group: t.group,
      })),
    };
  }

  // ---------------------------------------------------------------------------

  /** JSON-path filters aren't dependable on SQLite; the table is small. */
  private async countManaged(): Promise<number> {
    const rows = await this.prisma.connection.findMany({ select: { metadata: true } });
    return rows.filter((r) => isManaged(r.metadata)).length;
  }

  private async computePlan(): Promise<{
    output: PlannerOutput;
    rules: AutoLinkRuleDto[];
    suppressedCount: number;
    managedIdByKey: Map<string, string>;
  }> {
    let haDevices: HaDevice[];
    let haEntities: HaEntity[];
    let configEntries: HaConfigEntry[] = [];
    try {
      [haDevices, haEntities] = await Promise.all([
        this.client.listDevices(),
        this.client.listEntities(),
      ]);
      if (this.client.listConfigEntries) {
        configEntries = await this.client.listConfigEntries().catch((err: Error) => {
          this.logger.warn(`config_entries/get failed, continuing without: ${err.message}`);
          return [];
        });
      }
    } catch (err) {
      throw new BadGatewayException(
        `Could not read the Home Assistant registry: ${(err as Error).message}`
      );
    }

    const [localDevices, existing, ruleRows, suppressions] = await Promise.all([
      this.prisma.device.findMany({
        select: { id: true, name: true, haDeviceId: true, category: true },
      }),
      this.prisma.connection.findMany({
        select: { id: true, type: true, fromDeviceId: true, toDeviceId: true, metadata: true },
      }),
      this.listRules(),
      this.prisma.autoLinkSuppression.findMany({ select: { autoKey: true } }),
    ]);

    const input: PlannerInput = {
      localDevices,
      haDevices,
      haEntities,
      configEntries,
      rules: Object.fromEntries(ruleRows.map((r) => [r.type, r.controllerDeviceId])),
      existing,
      suppressedKeys: new Set(suppressions.map((s) => s.autoKey)),
    };
    const managedIdByKey = new Map<string, string>();
    for (const c of existing) if (isManaged(c.metadata)) managedIdByKey.set(c.metadata.autoKey, c.id);
    return {
      output: plan(input),
      rules: ruleRows,
      suppressedCount: suppressions.length,
      managedIdByKey,
    };
  }
}

function metadataFor(link: {
  autoKey: string;
  reason: AutoLinkMetadata['reason'];
  platforms: string[];
}): AutoLinkMetadata {
  return { auto: true, autoKey: link.autoKey, reason: link.reason, platforms: link.platforms };
}
