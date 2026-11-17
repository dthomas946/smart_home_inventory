import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { circuitOf, circuitSummary, ConnectionDto } from '@smart-home-inventory/shared';
import {
  mdiDelete,
  mdiGraphOutline,
  mdiPencil,
  mdiPinOutline,
  mdiPlus,
  mdiTransitConnectionVariant,
} from '@mdi/js';
import { ConnectionsApi, HaApi } from '../../core/api/api.services';
import { ReturnStore, SortDir, sortRows } from '../../core/navigation/return.store';
import { SortHeaderComponent } from '../../shared/ui/sort-header.component';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ConnectionTypesStore } from '../../core/connection-types/connection-types.store';
import { IconComponent } from '../../shared/ui/icon.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { ConnectionFormDialogComponent } from './connection-form-dialog.component';
import { AutoLinkPanelComponent } from './auto-link-panel.component';
import { ToastService } from '../../core/toast/toast.service';

@Component({
  selector: 'app-connections-page',
  imports: [
    RouterLink,
    IconComponent,
    EmptyStateComponent,
    ConnectionFormDialogComponent,
    AutoLinkPanelComponent,
    SortHeaderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="header">
      <h1>Connections</h1>
      <div class="head-actions">
        <a class="btn secondary" routerLink="/network">
          <app-icon [path]="icons.graph" [size]="18" /> Network map
        </a>
        <button class="btn" (click)="editing.set(null); dialogOpen.set(true)">
          <app-icon [path]="icons.plus" [size]="18" /> New connection
        </button>
      </div>
    </div>

    <app-auto-link-panel (applied)="load()" />

    <div class="filter-row">
      <input
        class="text search"
        type="search"
        placeholder="Search device, label, notes…"
        [value]="search()"
        (input)="setParam('q', $any($event.target).value)"
      />
      <span class="muted small">{{ filteredConnections().length }} of {{ connections().length }}</span>
    </div>
    <div class="chips">
      <button class="chip" [class.active]="!typeFilter()" (click)="setParam('type', '')">
        all
      </button>
      @for (group of connectionTypes.groups(); track group.group) {
        <span class="chip-group-label">{{ group.label }}</span>
        @for (t of group.types; track t.key) {
          <button
            class="chip"
            [class.active]="typeFilter() === t.key"
            (click)="setParam('type', typeFilter() === t.key ? '' : t.key)"
          >
            <span class="type-dot" [style.background]="t.color"></span>
            {{ t.label }}
          </button>
        }
      }
    </div>

    @if (filteredConnections().length > 0) {
      <table class="data card connections">
        <thead>
          <tr>
            @for (col of columns; track col.key) {
              <th>
                <app-sort-header
                  [key]="col.key"
                  [label]="col.label"
                  [sort]="sortKey()"
                  [dir]="sortDir()"
                  (sortChange)="sortBy($event)"
                />
              </th>
            }
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (conn of filteredConnections(); track conn.id) {
            <tr>
              <td>
                <a [routerLink]="['/devices', conn.fromDeviceId]" (click)="rememberReturn(conn.fromDeviceId)">{{ conn.fromDeviceName }}</a>
              </td>
              <td>
                <a [routerLink]="['/devices', conn.toDeviceId]" (click)="rememberReturn(conn.toDeviceId)">{{ conn.toDeviceName }}</a>
              </td>
              <td>
                <span class="type-dot" [style.background]="connectionTypes.color(conn.type)"></span>
                {{ connectionTypes.label(conn.type) }}
              </td>
              <td class="muted">
                @if (isAuto(conn)) {
                  <span class="auto-badge" title="Created by auto-link. Delete or make manual to override.">auto</span>
                }
                {{ conn.label }}
                @if (circuit(conn); as cs) {
                  <span class="chip circuit" title="Circuit">{{ cs }}</span>
                }
              </td>
              <td class="muted">{{ conn.notes }}</td>
              <td class="row-actions">
                <button class="btn icon-only" title="Edit" (click)="edit(conn)">
                  <app-icon [path]="icons.pencil" [size]="18" />
                </button>
                @if (isAuto(conn)) {
                  <button
                    class="btn icon-only"
                    title="Make manual — keep this link but stop auto-link from changing it"
                    (click)="makeManual(conn)"
                  >
                    <app-icon [path]="icons.pin" [size]="18" />
                  </button>
                }
                <button class="btn icon-only" [title]="isAuto(conn) ? 'Delete link (auto-link will not recreate it)' : 'Delete link'" (click)="remove(conn)">
                  <app-icon [path]="icons.delete" [size]="18" />
                </button>
                @if (conn.toDeviceSource === 'ha') {
                  <button
                    class="btn secondary small-btn"
                    [title]="'Exclude ' + conn.toDeviceName + ' from the inventory (removes the device and its links; future syncs will not add it back)'"
                    (click)="excludeTarget(conn)"
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
        [icon]="icons.connections"
        message="No connections documented yet"
      />
    }

    <app-connection-form-dialog
      [open]="dialogOpen()"
      [editing]="editing()"
      (closed)="dialogOpen.set(false); editing.set(null)"
      (saved)="dialogOpen.set(false); editing.set(null); load()"
    />
  `,
  styles: `
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .header h1 {
      margin: 0;
    }
    .chips {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .chip-group-label {
      font-size: 12px;
      color: var(--secondary-text-color);
      margin: 0 2px 0 8px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .type-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .connections td {
      vertical-align: middle;
    }
    .row-actions {
      text-align: right;
      white-space: nowrap;
    }
    .filter-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .filter-row .search {
      flex: 1;
      max-width: 420px;
    }
    .small {
      font-size: 0.85em;
    }
    .small-btn {
      padding: 2px 10px;
      font-size: 12px;
      margin-left: 4px;
    }
    .head-actions {
      display: flex;
      gap: 8px;
    }
    .auto-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      padding: 1px 5px;
      border-radius: 4px;
      margin-right: 6px;
      background: color-mix(in srgb, var(--primary-color) 18%, var(--chip-background-color));
    }
  `,
})
export class ConnectionsPageComponent implements OnInit {
  protected circuit(c: ConnectionDto): string {
    return circuitSummary(circuitOf(c.metadata));
  }

  private readonly api = inject(ConnectionsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly haApi = inject(HaApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly returnStore = inject(ReturnStore);
  protected readonly connectionTypes = inject(ConnectionTypesStore);

  protected readonly connections = signal<ConnectionDto[]>([]);
  // Filters, search and sort live in the URL so they survive opening a
  // device and coming back.
  protected readonly typeFilter = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDir = signal<SortDir>('asc');
  protected readonly columns: Array<{ key: string; label: string }> = [
    { key: 'source', label: 'Source' },
    { key: 'target', label: 'Target' },
    { key: 'type', label: 'Type' },
    { key: 'label', label: 'Label' },
    { key: 'notes', label: 'Notes' },
  ];
  private readonly sortGetters: Record<string, (c: ConnectionDto) => unknown> = {
    source: (c) => c.fromDeviceName,
    target: (c) => c.toDeviceName,
    type: (c) => this.connectionTypes.label(c.type),
    label: (c) => c.label,
    notes: (c) => c.notes,
  };
  protected readonly loaded = signal(false);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<ConnectionDto | null>(null);

  protected readonly icons = {
    plus: mdiPlus,
    delete: mdiDelete,
    pin: mdiPinOutline,
    pencil: mdiPencil,
    graph: mdiGraphOutline,
    connections: mdiTransitConnectionVariant,
  };

  protected readonly filteredConnections = computed(() => {
    const filter = this.typeFilter();
    const q = this.search().trim().toLowerCase();
    const order = this.connectionTypes.types().map((t) => t.key);
    const visible = this.connections().filter(
      (c) =>
        (!filter || c.type === filter) &&
        (!q ||
          [c.fromDeviceName, c.toDeviceName, c.label, c.notes, this.connectionTypes.label(c.type), circuitSummary(circuitOf(c.metadata)), circuitOf(c.metadata)?.serves]
            .filter(Boolean)
            .some((v) => (v as string).toLowerCase().includes(q)))
    );
    if (this.sortKey()) return sortRows(visible, this.sortKey(), this.sortDir(), this.sortGetters);
    // default: grouped by type, then source name
    return [...visible].sort((a, b) => {
      const typeDiff = order.indexOf(a.type) - order.indexOf(b.type);
      return typeDiff !== 0 ? typeDiff : a.fromDeviceName.localeCompare(b.fromDeviceName);
    });
  });

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((p) => {
      this.typeFilter.set(p.get('type') || null);
      this.search.set(p.get('q') ?? '');
      this.sortKey.set(p.get('sort'));
      this.sortDir.set(p.get('dir') === 'desc' ? 'desc' : 'asc');
    });
    this.load();
  }

  protected setParam(key: string, value: string): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: key === 'q', // typing shouldn't flood browser history
    });
  }

  protected sortBy(key: string): void {
    const dir: SortDir = this.sortKey() === key && this.sortDir() === 'asc' ? 'desc' : 'asc';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { sort: key, dir },
      queryParamsHandling: 'merge',
    });
  }

  protected rememberReturn(deviceId: string): void {
    this.returnStore.remember(deviceId, this.router.url, 'Connections');
  }

  protected async excludeTarget(conn: ConnectionDto): Promise<void> {
    const ok = await this.confirm.ask(
      `Exclude "${conn.toDeviceName}" from the inventory? The device and all its connections are removed, and future Home Assistant syncs won't add it back. Undo in Settings → Physical devices only.`,
      { confirmLabel: 'Exclude', skipKey: 'exclude-device' }
    );
    if (!ok) return;
    this.haApi.excludeDevice(conn.toDeviceId).subscribe(() => {
      this.toast.success(`Excluded ${conn.toDeviceName}`);
      this.load();
    });
  }

  protected load(): void {
    this.api.list().subscribe((connections) => {
      this.connections.set(connections);
      this.loaded.set(true);
    });
  }

  protected edit(conn: ConnectionDto): void {
    this.editing.set(conn);
    this.dialogOpen.set(true);
  }

  protected isAuto(conn: ConnectionDto): boolean {
    return conn.metadata?.['auto'] === true;
  }

  protected async makeManual(conn: ConnectionDto): Promise<void> {
    const ok = await this.confirm.ask(
      `Keep the ${this.connectionTypes.label(conn.type)} link "${conn.fromDeviceName}" → "${conn.toDeviceName}" but take it out of auto-link's hands? Re-runs will no longer change or remove it.`,
      { confirmLabel: 'Make manual' }
    );
    if (!ok) return;
    // Any update to a managed link converts it server-side; sending the
    // existing metadata back is enough to trigger that.
    this.api.update(conn.id, { metadata: conn.metadata ?? {} }).subscribe(() => {
      this.toast.success('Link is now manual');
      this.load();
    });
  }

  protected async remove(conn: ConnectionDto): Promise<void> {
    const confirmed = await this.confirm.ask(
      `Delete the ${this.connectionTypes.label(conn.type)} connection between "${conn.fromDeviceName}" and "${conn.toDeviceName}"?` +
        (this.isAuto(conn) ? ' Auto-link will remember this and not recreate it.' : ''),
      { confirmLabel: 'Delete' }
    );
    if (!confirmed) return;
    this.api.remove(conn.id).subscribe(() => this.load());
  }
}
