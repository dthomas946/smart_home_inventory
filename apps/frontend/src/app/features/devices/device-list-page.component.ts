import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AreaDto,
  CapabilityTypeDto,
  DEVICE_CATEGORIES,
  DEVICE_STATUSES,
  DeviceCategory,
  DeviceDto,
  DeviceQueryDto,
  DeviceStatus,
  EntitySource,
} from '@smart-home-inventory/shared';
import { mdiBookOpenVariant, mdiDevices, mdiPlus } from '@mdi/js';
import {
  AreasApi,
  CapabilitiesApi,
  DevicesApi,
  HaApi,
} from '../../core/api/api.services';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ToastService } from '../../core/toast/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { DeviceThumbComponent } from '../../shared/ui/device-thumb.component';
import { SourceBadgeComponent } from '../../shared/ui/source-badge.component';

type SourceFilter = EntitySource | 'all';
const SOURCE_PREF_KEY = 'shi.devices.source';

function readSourcePref(): SourceFilter {
  try {
    const v = localStorage.getItem(SOURCE_PREF_KEY);
    return v === 'manual' || v === 'ha' || v === 'all' ? v : 'manual';
  } catch {
    return 'manual';
  }
}
function writeSourcePref(v: SourceFilter): void {
  try {
    localStorage.setItem(SOURCE_PREF_KEY, v);
  } catch {
    /* storage unavailable — fine, it's only a convenience */
  }
}

@Component({
  selector: 'app-device-list-page',
  imports: [
    RouterLink,
    IconComponent,
    EmptyStateComponent,
    DeviceThumbComponent,
    SourceBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="header">
      <h1>Devices</h1>
      <a class="btn" routerLink="/devices/new">
        <app-icon [path]="icons.plus" [size]="18" /> New device
      </a>
    </div>

    <div class="filters card">
      <div class="segmented" role="group" aria-label="Which devices">
        @for (opt of sourceOptions; track opt.value) {
          <button
            type="button"
            [class.active]="sourceFilter() === opt.value"
            (click)="setSource(opt.value)"
            [title]="opt.hint"
          >
            {{ opt.label }}
          </button>
        }
      </div>
      <input
        class="text search"
        type="search"
        placeholder="Search name, brand, manufacturer, model, serial…"
        [value]="query().q ?? ''"
        (input)="setFilter('q', $any($event.target).value)"
      />
      <select class="text" [value]="query().areaId ?? ''" (change)="setFilter('areaId', $any($event.target).value)">
        <option value="">All areas</option>
        @for (area of areas(); track area.id) {
          <option [value]="area.id">{{ area.name }}</option>
        }
      </select>
      @if (integrationOptions().length) {
        <select class="text" [value]="query().integration ?? ''" (change)="setFilter('integration', $any($event.target).value)">
          <option value="">All integrations</option>
          @for (opt of integrationOptions(); track opt.key) {
            <option [value]="opt.key">{{ opt.key }} ({{ opt.count }})</option>
          }
        </select>
      }
      @if (duplicateTotal() > 0) {
        <button
          type="button"
          class="dup-toggle"
          [class.active]="!!query().duplicates"
          (click)="setFilter('duplicates', query().duplicates ? '' : '1')"
          title="Show only devices that look like the same hardware as another"
        >
          Possible duplicates ({{ duplicateTotal() }})
        </button>
      }
      <select class="text" [value]="query().category ?? ''" (change)="setFilter('category', $any($event.target).value)">
        <option value="">All categories</option>
        @for (cat of categories; track cat) {
          <option [value]="cat">{{ cat }}</option>
        }
      </select>
      <select class="text" [value]="query().status ?? ''" (change)="setFilter('status', $any($event.target).value)">
        <option value="">Any status</option>
        @for (status of statuses; track status) {
          <option [value]="status">{{ status }}</option>
        }
      </select>
      <div class="chips">
        @for (cap of capabilities(); track cap.id) {
          <button
            class="chip"
            [class.active]="query().capability === cap.key"
            (click)="toggleCapability(cap.key)"
          >
            {{ cap.label }}
          </button>
        }
      </div>
    </div>

    @if (devices().length > 0) {
      <table class="data card devices">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Area</th>
            <th>Model</th>
            <th>Integration</th>
            <th>Serial</th>
            <th>Docs</th>
            <th>Capabilities</th>
            <th>Status</th>
            <th>Source</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (device of devices(); track device.id) {
            <tr class="clickable" (click)="open(device)">
              <td class="thumb-cell">
                <app-device-thumb [imageId]="device.primaryImageId" [size]="36" />
              </td>
              <td>
                {{ device.name }}
                @if (device.haOrphaned) {
                  <span class="warn" title="No longer in Home Assistant">⚠</span>
                }
                @if (device.duplicates.length) {
                  <span class="dup-badge" [title]="dupTitle(device)">
                    {{ device.duplicates[0].reason === 'mac' ? 'duplicate' : 'possible duplicate' }}
                  </span>
                }
              </td>
              <td class="muted">{{ device.areaName ?? '—' }}</td>
              <td class="muted">{{ device.brand ?? device.manufacturer }} {{ device.model }}</td>
              <td class="int-cell">
                @for (i of device.integrations; track i) {
                  <span class="int-chip">{{ i }}</span>
                } @empty {
                  <span class="muted">—</span>
                }
              </td>
              <td class="muted mono">{{ device.serialNumber ?? '—' }}</td>
              <td class="docs-cell">
                @if (device.manualCount > 0) {
                  <span
                    class="doc-badge has"
                    [title]="device.manualCount + (device.manualCount === 1 ? ' manual attached' : ' manuals attached')"
                  >
                    <app-icon [path]="icons.manual" [size]="14" /> {{ device.manualCount }}
                  </span>
                } @else if (!device.serialNumber && !device.model) {
                  <span class="doc-badge todo" title="No model or serial yet — open and scan the rating label">
                    scan label
                  </span>
                } @else {
                  <span class="doc-badge none" title="No manual attached yet">—</span>
                }
              </td>
              <td>
                @for (key of device.capabilityKeys; track key) {
                  <span class="chip">{{ key }}</span>
                }
              </td>
              <td class="muted">{{ device.status }}</td>
              <td class="source-cell">
                <app-source-badge [source]="device.source" />
              </td>
              <td class="row-actions">
                @if (device.haDeviceId && device.duplicates.length) {
                  <button
                    class="btn secondary small-btn"
                    title="Not the copy you want — remove it and keep future syncs from adding it back"
                    (click)="exclude(device, $event)"
                  >
                    Exclude
                  </button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    } @else if (loaded()) {
      <app-empty-state
        [icon]="icons.devices"
        [message]="
          sourceFilter() === 'manual' && !query().q && !query().areaId && !query().category
            ? 'No equipment yet — use New device, then Take photo to scan a rating label'
            : 'No devices match'
        "
      />
    }
  `,
  styles: `
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header h1 {
      margin: 0;
    }
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 16px;
      padding: 12px 16px;
    }
    .search {
      flex: 1;
      min-width: 200px;
    }
    .filters select {
      width: auto;
    }
    .chips {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      width: 100%;
    }
    .devices {
      padding: 0;
    }
    .thumb-cell {
      width: 44px;
    }
    .source-cell {
      width: 1%;
      white-space: nowrap;
    }
    .warn {
      color: var(--warning-color);
    }
    td .chip {
      margin-right: 4px;
    }
    .segmented {
      display: inline-flex;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .segmented button {
      background: transparent;
      border: 0;
      border-right: 1px solid var(--divider-color);
      padding: 6px 12px;
      color: var(--secondary-text-color);
      cursor: pointer;
      font: inherit;
    }
    .segmented button:last-child {
      border-right: 0;
    }
    .segmented button.active {
      background: color-mix(in srgb, var(--primary-color) 18%, transparent);
      color: var(--primary-text-color);
      font-weight: 600;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.9em;
    }
    .docs-cell {
      white-space: nowrap;
    }
    .doc-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .doc-badge.has {
      background: color-mix(in srgb, var(--success-color, #2e7d32) 18%, transparent);
      color: var(--primary-text-color);
    }
    .doc-badge.todo {
      background: color-mix(in srgb, var(--warning-color, #f9a825) 22%, transparent);
      color: var(--primary-text-color);
    }
    .int-cell {
      white-space: nowrap;
    }
    .int-chip {
      display: inline-block;
      font-size: 11px;
      padding: 1px 6px;
      margin-right: 3px;
      border-radius: 4px;
      background: var(--chip-background-color);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .dup-badge {
      display: inline-block;
      margin-left: 6px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 1px 5px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--warning-color, #f9a825) 28%, transparent);
      cursor: help;
    }
    .dup-toggle {
      background: transparent;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 6px 10px;
      color: var(--secondary-text-color);
      cursor: pointer;
      font: inherit;
    }
    .dup-toggle.active {
      background: color-mix(in srgb, var(--warning-color, #f9a825) 22%, transparent);
      color: var(--primary-text-color);
      font-weight: 600;
    }
    .row-actions {
      text-align: right;
      white-space: nowrap;
    }
    .small-btn {
      padding: 2px 10px;
      font-size: 12px;
    }
    .doc-badge.none {
      color: var(--secondary-text-color);
    }
  `,
})
export class DeviceListPageComponent implements OnInit {
  private readonly devicesApi = inject(DevicesApi);
  private readonly areasApi = inject(AreasApi);
  private readonly capabilitiesApi = inject(CapabilitiesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly haApi = inject(HaApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected readonly devices = signal<DeviceDto[]>([]);
  protected readonly areas = signal<AreaDto[]>([]);
  protected readonly capabilities = signal<CapabilityTypeDto[]>([]);
  protected readonly query = signal<DeviceQueryDto>({});
  protected readonly loaded = signal(false);
  protected readonly statuses = DEVICE_STATUSES;
  protected readonly categories = DEVICE_CATEGORIES;
  protected readonly icons = { plus: mdiPlus, devices: mdiDevices, manual: mdiBookOpenVariant };

  /** Which population the list shows. `manual` is the gear you entered
   *  yourself (appliances, HVAC, …); `ha` is everything synced from Home
   *  Assistant. Remembered per browser so the list opens where you left it. */
  protected readonly sourceOptions: Array<{
    value: SourceFilter;
    label: string;
    hint: string;
  }> = [
    { value: 'manual', label: 'Equipment', hint: 'Devices you added yourself' },
    { value: 'ha', label: 'Smart home', hint: 'Devices synced from Home Assistant' },
    { value: 'all', label: 'All', hint: 'Everything' },
  ];
  protected readonly sourceFilter = signal<SourceFilter>('manual');
  protected readonly integrationOptions = signal<Array<{ key: string; count: number }>>([]);
  protected readonly duplicateTotal = signal(0);

  ngOnInit(): void {
    this.areasApi.list().subscribe((areas) => this.areas.set(areas));
    this.capabilitiesApi.listTypes().subscribe((caps) => this.capabilities.set(caps));
    // Filters live in query params so list state survives back-navigation.
    this.route.queryParamMap.subscribe((params) => {
      // No ?source in the URL means "whatever I picked last time", defaulting
      // to Equipment — the hand-entered gear is what this list is for.
      const source = (params.get('source') as SourceFilter | null) ?? readSourcePref();
      this.sourceFilter.set(source);
      this.query.set({
        q: params.get('q') ?? undefined,
        areaId: params.get('areaId') ?? undefined,
        status: (params.get('status') as DeviceStatus | null) ?? undefined,
        category: (params.get('category') as DeviceCategory | null) ?? undefined,
        capability: params.get('capability') ?? undefined,
        source: source === 'all' ? undefined : (source as EntitySource),
        integration: params.get('integration') ?? undefined,
        duplicates: params.get('duplicates') ? '1' : undefined,
      });
      this.load();
    });
    this.loadFacets();
  }

  /** Integration choices and the duplicate count come from the whole table,
   *  not the filtered view, so the filters don't hide their own options. */
  private loadFacets(): void {
    this.devicesApi.list({}).subscribe((all) => {
      const counts = new Map<string, number>();
      for (const d of all) for (const i of d.integrations) counts.set(i, (counts.get(i) ?? 0) + 1);
      this.integrationOptions.set(
        [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key))
      );
      this.duplicateTotal.set(all.filter((d) => d.duplicates.length > 0).length);
    });
  }

  protected dupTitle(device: DeviceDto): string {
    return (
      'Looks like the same hardware as: ' +
      device.duplicates
        .map(
          (h) =>
            `${h.name} (${h.integrations.join(', ') || 'added by you'}; ${h.reason === 'mac' ? 'same MAC' : 'same name'})`
        )
        .join('; ')
    );
  }

  protected async exclude(device: DeviceDto, event: Event): Promise<void> {
    event.stopPropagation();
    const other = device.duplicates[0];
    const ok = await this.confirm.ask(
      `Exclude "${device.name}" (${device.integrations.join(', ') || 'Home Assistant'}) from the inventory?` +
        (other ? ` "${other.name}" (${other.integrations.join(', ') || 'added by you'}) stays.` : '') +
        ` Future syncs won't add it back; undo in Settings → Physical devices only.`,
      { confirmLabel: 'Exclude' }
    );
    if (!ok) return;
    this.haApi.excludeDevice(device.id).subscribe(() => {
      this.toast.success(`Excluded ${device.name}`);
      this.load();
      this.loadFacets();
    });
  }

  protected load(): void {
    this.devicesApi.list(this.query()).subscribe((devices) => {
      this.devices.set(devices);
      this.loaded.set(true);
    });
  }

  protected setFilter(key: keyof DeviceQueryDto, value: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
    });
  }

  protected setSource(value: SourceFilter): void {
    writeSourcePref(value);
    this.setFilter('source', value);
  }

  protected toggleCapability(key: string): void {
    this.setFilter('capability', this.query().capability === key ? '' : key);
  }

  protected open(device: DeviceDto): void {
    this.router.navigate(['/devices', device.id]);
  }
}
