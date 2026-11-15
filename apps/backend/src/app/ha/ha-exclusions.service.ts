import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CreateSyncExclusionDto,
  ExcludedDeviceDto,
  SyncExclusionDto,
  SyncExclusionKind,
  SyncExclusionsDto,
} from '@smart-home-inventory/shared';
import { isManaged } from '../auto-link/auto-link.planner';
import { PrismaService } from '../prisma/prisma.service';
import {
  BUILT_IN_VIRTUAL_INTEGRATIONS,
  exclusionReason,
  ExclusionRules,
  integrationsOf,
} from './device-exclusion';
import { HA_REGISTRY_CLIENT, HaConfigEntry, HaDevice, HaRegistryClient } from './ha-registry.types';

export interface ExclusionResult {
  /** HA device id → reason */
  excluded: Map<string, string>;
}

@Injectable()
export class HaExclusionsService {
  private readonly logger = new Logger(HaExclusionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(HA_REGISTRY_CLIENT) private readonly client: HaRegistryClient
  ) {}

  async rules(): Promise<ExclusionRules> {
    const rows = await this.prisma.syncExclusion.findMany();
    return {
      manufacturers: rows.filter((r) => r.kind === 'manufacturer').map((r) => r.value),
      integrations: rows.filter((r) => r.kind === 'integration').map((r) => r.value),
      deviceIds: rows.filter((r) => r.kind === 'device').map((r) => r.value),
    };
  }

  async configEntries(): Promise<HaConfigEntry[]> {
    if (!this.client.listConfigEntries) return [];
    return this.client.listConfigEntries().catch((err: Error) => {
      this.logger.warn(`config_entries/get failed; integration rules skipped: ${err.message}`);
      return [];
    });
  }

  /** Classify a set of HA devices against built-in + user rules. */
  classify(
    devices: HaDevice[],
    configEntries: HaConfigEntry[],
    rules: ExclusionRules
  ): ExclusionResult {
    const excluded = new Map<string, string>();
    for (const d of devices) {
      const reason = exclusionReason(d, integrationsOf(d, configEntries), rules);
      if (reason) excluded.set(d.id, reason);
    }
    return { excluded };
  }

  /**
   * Remove excluded devices from the inventory unless they hold something
   * the user added (attachments, hand-drawn connections, notes, a serial).
   * Those stay, are reported as "kept", and can be deleted by hand.
   */
  async purge(excludedHaIds: Iterable<string>): Promise<{ removed: number; kept: number }> {
    const ids = [...excludedHaIds];
    if (ids.length === 0) return { removed: 0, kept: 0 };
    const locals = await this.prisma.device.findMany({
      where: { haDeviceId: { in: ids } },
      select: { id: true },
    });
    let removed = 0;
    let kept = 0;
    for (const { id } of locals) {
      if (await this.keptBecause(id)) {
        kept++;
        continue;
      }
      await this.prisma.device.delete({ where: { id } });
      removed++;
    }
    if (removed) this.logger.log(`Removed ${removed} excluded (non-physical) devices`);
    return { removed, kept };
  }

  private async keptBecause(localId: string): Promise<string | null> {
    const d = await this.prisma.device.findUnique({
      where: { id: localId },
      select: {
        notes: true,
        serialNumber: true,
        _count: { select: { attachments: true } },
        connectionsFrom: { select: { metadata: true } },
        connectionsTo: { select: { metadata: true } },
      },
    });
    if (!d) return null;
    if (d._count.attachments > 0) return 'has attachments';
    const manual = [...d.connectionsFrom, ...d.connectionsTo].filter((c) => !isManaged(c.metadata));
    if (manual.length > 0) return 'has connections you drew';
    if (d.notes?.trim()) return 'has notes';
    if (d.serialNumber?.trim()) return 'has a serial number';
    return null;
  }

  async overview(): Promise<SyncExclusionsDto> {
    const [devices, configEntries, rows] = await Promise.all([
      this.client.listDevices(),
      this.configEntries(),
      this.prisma.syncExclusion.findMany({ orderBy: [{ kind: 'asc' }, { value: 'asc' }] }),
    ]);
    const rules = await this.rules();
    const { excluded } = this.classify(devices, configEntries, rules);

    const locals = await this.prisma.device.findMany({
      where: { haDeviceId: { in: [...excluded.keys()] } },
      select: { id: true, haDeviceId: true },
    });
    const localByHa = new Map(locals.map((l) => [l.haDeviceId as string, l.id]));

    const excludedList: ExcludedDeviceDto[] = [];
    for (const d of devices) {
      const reason = excluded.get(d.id);
      if (!reason || reason === 'service entry') continue;
      const localId = localByHa.get(d.id) ?? null;
      excludedList.push({
        haDeviceId: d.id,
        name: d.name_by_user || d.name || d.id,
        manufacturer: d.manufacturer,
        integrations: integrationsOf(d, configEntries),
        reason,
        keptLocalId: localId,
        keptBecause: localId ? await this.keptBecause(localId) : null,
      });
    }
    excludedList.sort((a, b) => a.reason.localeCompare(b.reason) || a.name.localeCompare(b.name));

    const matchCount = (kind: string, value: string) =>
      devices.filter((d) => {
        if (kind === 'device') return d.id === value;
        if (kind === 'manufacturer') return (d.manufacturer ?? '').toLowerCase() === value.toLowerCase();
        return integrationsOf(d, configEntries).includes(value.toLowerCase());
      }).length;

    const manufacturers = new Set<string>();
    const integrations = new Set<string>();
    for (const d of devices) {
      if (d.entry_type === 'service') continue;
      if (d.manufacturer) manufacturers.add(d.manufacturer);
      for (const i of integrationsOf(d, configEntries)) integrations.add(i);
    }

    return {
      rules: rows.map(
        (r): SyncExclusionDto => ({
          id: r.id,
          kind: r.kind as SyncExclusionKind,
          value: r.value,
          label: r.label,
          matchCount: matchCount(r.kind, r.value),
        })
      ),
      excluded: excludedList,
      builtInVirtualIntegrations: [...BUILT_IN_VIRTUAL_INTEGRATIONS],
      knownManufacturers: [...manufacturers].sort((a, b) => a.localeCompare(b)),
      knownIntegrations: [...integrations].sort(),
    };
  }

  async add(dto: CreateSyncExclusionDto): Promise<void> {
    const value = dto.kind === 'integration' ? dto.value.toLowerCase() : dto.value;
    const exists = await this.prisma.syncExclusion.findUnique({
      where: { kind_value: { kind: dto.kind, value } },
    });
    if (exists) throw new ConflictException('That rule already exists');
    await this.prisma.syncExclusion.create({
      data: { kind: dto.kind, value, label: dto.label ?? null },
    });
  }

  /** Exclude one synced device by its local id (from the device page). */
  async excludeLocalDevice(localId: string): Promise<{ haDeviceId: string }> {
    const d = await this.prisma.device.findUnique({
      where: { id: localId },
      select: { haDeviceId: true, name: true },
    });
    if (!d) throw new NotFoundException(`Device ${localId} not found`);
    if (!d.haDeviceId) {
      throw new ConflictException('Only devices synced from Home Assistant can be excluded; delete this one instead');
    }
    await this.prisma.syncExclusion.upsert({
      where: { kind_value: { kind: 'device', value: d.haDeviceId } },
      create: { kind: 'device', value: d.haDeviceId, label: d.name },
      update: {},
    });
    // Explicit, per-device request (the UI confirms first): remove it now
    // even if it holds attachments or connections.
    await this.prisma.device.delete({ where: { id: localId } });
    return { haDeviceId: d.haDeviceId };
  }

  async remove(id: string): Promise<void> {
    const { count } = await this.prisma.syncExclusion.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException(`Rule ${id} not found`);
  }
}
