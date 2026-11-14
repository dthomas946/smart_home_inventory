import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConnectionDto } from '@smart-home-inventory/shared';
import {
  mdiDelete,
  mdiGraphOutline,
  mdiPencil,
  mdiPinOutline,
  mdiPlus,
  mdiTransitConnectionVariant,
} from '@mdi/js';
import { ConnectionsApi } from '../../core/api/api.services';
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

    <div class="chips">
      <button class="chip" [class.active]="!typeFilter()" (click)="typeFilter.set(null)">
        all
      </button>
      @for (group of connectionTypes.groups(); track group.group) {
        <span class="chip-group-label">{{ group.label }}</span>
        @for (t of group.types; track t.key) {
          <button
            class="chip"
            [class.active]="typeFilter() === t.key"
            (click)="typeFilter.set(typeFilter() === t.key ? null : t.key)"
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
            <th>Source</th>
            <th>Target</th>
            <th>Type</th>
            <th>Label</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (conn of filteredConnections(); track conn.id) {
            <tr>
              <td>
                <a [routerLink]="['/devices', conn.fromDeviceId]">{{ conn.fromDeviceName }}</a>
              </td>
              <td>
                <a [routerLink]="['/devices', conn.toDeviceId]">{{ conn.toDeviceName }}</a>
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
                <button class="btn icon-only" [title]="isAuto(conn) ? 'Delete (auto-link will not recreate it)' : 'Delete'" (click)="remove(conn)">
                  <app-icon [path]="icons.delete" [size]="18" />
                </button>
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
  private readonly api = inject(ConnectionsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly connectionTypes = inject(ConnectionTypesStore);

  protected readonly connections = signal<ConnectionDto[]>([]);
  protected readonly typeFilter = signal<string | null>(null);
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
    const order = this.connectionTypes.types().map((t) => t.key);
    const visible = this.connections().filter((c) => !filter || c.type === filter);
    return [...visible].sort((a, b) => {
      const typeDiff = order.indexOf(a.type) - order.indexOf(b.type);
      return typeDiff !== 0 ? typeDiff : a.fromDeviceName.localeCompare(b.fromDeviceName);
    });
  });

  ngOnInit(): void {
    this.load();
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
