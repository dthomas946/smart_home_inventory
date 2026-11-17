import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HaStatusDto, SyncResultDto } from '@smart-home-inventory/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { HA_REGISTRY_CLIENT, HaRegistryClient } from './ha-registry.types';
import { mergeRegistry } from './ha-sync.merge';
import { HaExclusionsService } from './ha-exclusions.service';
import { HaLocaleService } from './ha-locale.service';
import { ConnectionTypeGroup, isNorthAmerica } from '@smart-home-inventory/shared';
import { integrationsOf } from './device-exclusion';
import { HaConfigEntry, HaDevice } from './ha-registry.types';

@Injectable()
export class HaSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HaSyncService.name);
  private lastSyncAt: Date | null = null;
  private lastSyncResult: SyncResultDto | null = null;
  private syncRunning = false;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(HA_REGISTRY_CLIENT) private readonly client: HaRegistryClient,
    private readonly exclusions: HaExclusionsService,
    private readonly locale: HaLocaleService
  ) {}

  onModuleInit(): void {
    if (this.config.haSyncIntervalMinutes > 0) {
      this.interval = setInterval(
        () =>
          this.sync().catch((err) =>
            this.logger.warn(`Periodic HA sync failed: ${err.message}`)
          ),
        this.config.haSyncIntervalMinutes * 60 * 1000
      );
      this.interval.unref();
    }
    if (this.config.haMode === 'supervisor') {
      // One startup sync attempt in the add-on; failures are non-fatal.
      this.sync().catch((err) =>
        this.logger.warn(`Startup HA sync failed: ${err.message}`)
      );
    }
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  /** Keep each synced device's integration list and MACs current — they
   *  drive the Integration column and duplicate hints on the Devices page. */
  private async refreshDeviceIdentity(
    remoteDevices: HaDevice[],
    configEntries: HaConfigEntry[]
  ): Promise<void> {
    const byHaId = new Map(remoteDevices.map((d) => [d.id, d]));
    const locals = await this.prisma.device.findMany({
      where: { haDeviceId: { not: null } },
      select: { id: true, haDeviceId: true, haIntegrations: true, haMacs: true },
    });
    let changed = 0;
    for (const l of locals) {
      const remote = byHaId.get(l.haDeviceId as string);
      if (!remote) continue;
      const integrations = integrationsOf(remote, configEntries).join(',') || null;
      const macs =
        [
          ...new Set(
            (remote.connections ?? [])
              .filter(([kind]) => kind === 'mac')
              .map(([, v]) => v.toLowerCase().replace(/-/g, ':'))
          ),
        ]
          .sort()
          .join(',') || null;
      if (integrations !== l.haIntegrations || macs !== l.haMacs) {
        await this.prisma.device.update({
          where: { id: l.id },
          data: { haIntegrations: integrations, haMacs: macs },
        });
        changed++;
      }
    }
    if (changed) this.logger.log(`Updated integrations/MACs on ${changed} devices`);
  }

  /** Devices still on the old built-in currency default (EUR, no price
   *  entered) follow Home Assistant's currency. Anything with a price the
   *  user typed is left exactly as entered. */
  private async applyLocaleDefaults(): Promise<void> {
    const locale = await this.locale.get(true);
    if (locale.fromHa && isNorthAmerica(locale.country)) await this.ensureNorthAmericanPowerTypes();
    if (!locale.fromHa || locale.currency === 'EUR') return;
    const { count } = await this.prisma.device.updateMany({
      where: {
        purchasePriceCents: null,
        OR: [{ purchaseCurrency: 'EUR' }, { purchaseCurrency: null }],
      },
      data: { purchaseCurrency: locale.currency },
    });
    if (count) this.logger.log(`Set currency to ${locale.currency} (from HA) on ${count} devices`);
  }

  /** The built-in power type is Europe's 230 V; in the US/CA/MX add the
   *  local ones (once — renaming or recolouring them afterwards sticks). */
  private async ensureNorthAmericanPowerTypes(): Promise<void> {
    const wanted = [
      { key: 'mains_120v', label: '120V', group: 'wired', color: '#fbc02d', dash: 'solid', utility: 'electrical' },
      { key: 'mains_240v', label: '240V', group: 'wired', color: '#6a1b9a', dash: 'solid', utility: 'electrical' },
      { key: 'ac_24v', label: '24V AC (HVAC control)', group: 'wired', color: '#2e7d32', dash: 'dashed', utility: 'electrical' },
    ];
    for (const t of wanted) {
      const exists = await this.prisma.connectionType.findUnique({ where: { key: t.key } });
      if (!exists) {
        await this.prisma.connectionType.create({
          data: { ...t, group: t.group as ConnectionTypeGroup, isSystem: false },
        });
        this.logger.log(`Added ${t.label} connection type (North America)`);
      }
    }
  }

  async status(): Promise<HaStatusDto> {
    return {
      mode: this.config.haMode,
      connected: await this.client.ping(),
      readOnly: this.config.haReadOnly,
      lastSyncAt: this.lastSyncAt?.toISOString() ?? null,
      lastSyncResult: this.lastSyncResult,
    };
  }

  async sync(): Promise<SyncResultDto> {
    if (this.syncRunning) {
      throw new ServiceUnavailableException('A sync is already running');
    }
    this.syncRunning = true;
    try {
      return await this.doSync();
    } finally {
      this.syncRunning = false;
    }
  }

  private async doSync(): Promise<SyncResultDto> {
    const [remoteFloors, remoteAreas, allRemoteDevices, configEntries, rules] = await Promise.all([
      this.client.listFloors(),
      this.client.listAreas(),
      this.client.listDevices(),
      this.exclusions.configEntries(),
      this.exclusions.rules(),
    ]);
    // Physical devices only: drop virtual ones (add-ons, Downdetector feeds,
    // weather, cloud accounts, user rules) before merging, then purge any
    // local copies left from earlier syncs.
    const { excluded } = this.exclusions.classify(allRemoteDevices, configEntries, rules);
    const remoteDevices = allRemoteDevices.filter((d) => !excluded.has(d.id));

    const result = await this.prisma.$transaction(async (tx) => {
      const localFloors = await tx.floor.findMany({
        select: { id: true, name: true, haFloorId: true, haName: true, haOrphaned: true },
      });
      const localAreas = await tx.area.findMany({
        select: {
          id: true,
          name: true,
          floorId: true,
          haAreaId: true,
          haName: true,
          haFloorIdAtSync: true,
          haOrphaned: true,
        },
      });
      const localDevices = await tx.device.findMany({
        select: {
          id: true,
          name: true,
          manufacturer: true,
          model: true,
          areaId: true,
          haDeviceId: true,
          haName: true,
          haAreaIdAtSync: true,
          haOrphaned: true,
        },
      });

      const merge = mergeRegistry(
        { floors: localFloors, areas: localAreas, devices: localDevices },
        { floors: remoteFloors, areas: remoteAreas, devices: remoteDevices }
      );

      for (const op of merge.floorCreates) {
        await tx.floor.create({
          data: {
            name: op.name,
            level: op.level,
            haFloorId: op.haFloorId,
            haName: op.name,
            source: 'ha',
          },
        });
      }
      for (const op of merge.floorUpdates) {
        await tx.floor.update({ where: { id: op.id }, data: op.data });
      }

      // Resolve HA floor ids to local floor ids (including freshly created ones).
      const floorsNow = await tx.floor.findMany({
        where: { haFloorId: { not: null } },
        select: { id: true, haFloorId: true },
      });
      const floorIdByHaId = new Map(floorsNow.map((f) => [f.haFloorId as string, f.id]));
      const resolveFloor = (haFloorRef: string | null): string | null =>
        haFloorRef ? floorIdByHaId.get(haFloorRef) ?? null : null;

      for (const op of merge.areaCreates) {
        await tx.area.create({
          data: {
            name: op.name,
            haAreaId: op.haAreaId,
            haName: op.name,
            haFloorIdAtSync: op.haFloorRef,
            floorId: resolveFloor(op.haFloorRef),
            source: 'ha',
          },
        });
      }
      for (const op of merge.areaUpdates) {
        await tx.area.update({
          where: { id: op.id },
          data: {
            ...op.data,
            ...(op.haFloorRef !== undefined ? { floorId: resolveFloor(op.haFloorRef) } : {}),
          },
        });
      }

      // Resolve HA area ids to local area ids (including freshly created ones).
      const areasNow = await tx.area.findMany({
        where: { haAreaId: { not: null } },
        select: { id: true, haAreaId: true },
      });
      const areaIdByHaId = new Map(areasNow.map((a) => [a.haAreaId as string, a.id]));
      const resolveArea = (haAreaRef: string | null): string | null =>
        haAreaRef ? areaIdByHaId.get(haAreaRef) ?? null : null;

      for (const op of merge.deviceCreates) {
        await tx.device.create({
          data: {
            name: op.name,
            manufacturer: op.manufacturer,
            model: op.model,
            haDeviceId: op.haDeviceId,
            haName: op.name,
            haAreaIdAtSync: op.haAreaRef,
            areaId: resolveArea(op.haAreaRef),
            source: 'ha',
          },
        });
      }
      for (const op of merge.deviceUpdates) {
        await tx.device.update({
          where: { id: op.id },
          data: {
            ...op.data,
            ...(op.haAreaRef !== undefined
              ? { areaId: resolveArea(op.haAreaRef) }
              : {}),
          },
        });
      }

      const floorUpdated = merge.floorUpdates.filter((u) => !u.data.haOrphaned).length;
      const floorOrphaned = merge.floorUpdates.filter((u) => u.data.haOrphaned).length;
      const areaUpdated = merge.areaUpdates.filter((u) => !u.data.haOrphaned).length;
      const areaOrphaned = merge.areaUpdates.filter((u) => u.data.haOrphaned).length;
      const deviceUpdated = merge.deviceUpdates.filter((u) => !u.data.haOrphaned).length;
      const deviceOrphaned = merge.deviceUpdates.filter((u) => u.data.haOrphaned).length;

      const syncResult: SyncResultDto = {
        floors: {
          created: merge.floorCreates.length,
          updated: floorUpdated,
          orphaned: floorOrphaned,
          unchanged: remoteFloors.length - merge.floorCreates.length - floorUpdated,
        },
        areas: {
          created: merge.areaCreates.length,
          updated: areaUpdated,
          orphaned: areaOrphaned,
          unchanged: remoteAreas.length - merge.areaCreates.length - areaUpdated,
        },
        devices: {
          created: merge.deviceCreates.length,
          updated: deviceUpdated,
          orphaned: deviceOrphaned,
          unchanged:
            remoteDevices.filter((d) => d.entry_type !== 'service').length -
            merge.deviceCreates.length -
            deviceUpdated,
        },
        warnings: merge.warnings,
        syncedAt: new Date().toISOString(),
      };
      return syncResult;
    });

    const purge = await this.exclusions.purge(excluded.keys());
    await this.refreshDeviceIdentity(remoteDevices, configEntries);
    await this.applyLocaleDefaults();
    const skipped = [...excluded.values()].filter((r) => r !== 'service entry').length;
    result.excluded = { skipped, removed: purge.removed, kept: purge.kept };

    this.lastSyncAt = new Date();
    this.lastSyncResult = result;
    this.logger.log(
      `HA sync done: floors +${result.floors.created}/~${result.floors.updated}, ` +
        `areas +${result.areas.created}/~${result.areas.updated}, ` +
        `devices +${result.devices.created}/~${result.devices.updated}, ` +
        `non-physical skipped ${skipped} (removed ${purge.removed}, kept ${purge.kept})`
    );
    return result;
  }
}
