import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SyncExclusionKind, SyncExclusionsDto } from '@smart-home-inventory/shared';
import { mdiDelete } from '@mdi/js';
import { HaApi } from '../../core/api/api.services';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ToastService } from '../../core/toast/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * "Physical devices only": the rules that keep Home Assistant's virtual
 * devices (add-ons, Downdetector feeds, weather, cloud accounts) out of the
 * inventory, and a live list of what they exclude right now.
 */
@Component({
  selector: 'app-sync-exclusions',
  imports: [FormsModule, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card section">
      <h3>Physical devices only</h3>
      <p class="muted">
        Home Assistant registers plenty of things as "devices" that aren't hardware. These are
        skipped on sync and removed from the inventory (unless you've added attachments, notes, a
        serial or hand-drawn connections to one — those are kept and listed below). Remove a rule
        and the devices come back on the next sync.
      </p>
      @if (confirmSkipped()) {
        <p class="muted">
          Exclude no longer asks for confirmation in this browser.
          <button type="button" class="btn secondary small-reset" (click)="resetConfirm()">Ask again</button>
        </p>
      }

      <h4>Your rules</h4>
      @if (data()?.rules?.length) {
        <table class="data">
          <tbody>
            @for (r of data()!.rules; track r.id) {
              <tr>
                <td><span class="chip">{{ r.kind }}</span></td>
                <td>{{ r.kind === 'device' ? (r.label ?? r.value) : r.value }}</td>
                <td class="muted">{{ r.matchCount }} device{{ r.matchCount === 1 ? '' : 's' }}</td>
                <td class="row-actions">
                  <button class="btn icon-only" title="Remove rule" [disabled]="busy()" (click)="remove(r.id)">
                    <app-icon [path]="icons.delete" [size]="18" />
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="muted small">None yet — only the built-in rules apply.</p>
      }

      <form class="add" (ngSubmit)="add()">
        <select class="text" name="kind" [(ngModel)]="kind">
          <option value="manufacturer">Manufacturer</option>
          <option value="integration">Integration</option>
        </select>
        <input
          class="text"
          name="value"
          [attr.list]="kind === 'manufacturer' ? 'shi-mfrs' : 'shi-ints'"
          [placeholder]="kind === 'manufacturer' ? 'e.g. Downdetector' : 'e.g. mqtt'"
          [(ngModel)]="value"
        />
        <datalist id="shi-mfrs">
          @for (m of data()?.knownManufacturers ?? []; track m) {
            <option [value]="m"></option>
          }
        </datalist>
        <datalist id="shi-ints">
          @for (i of data()?.knownIntegrations ?? []; track i) {
            <option [value]="i"></option>
          }
        </datalist>
        <button class="btn" type="submit" [disabled]="busy() || !value.trim()">Exclude</button>
      </form>
      <p class="muted small">
        Single devices: open the device and use <em>Exclude from inventory</em>.
      </p>

      @if (data(); as d) {
        <details>
          <summary>
            Currently excluded: <strong>{{ d.excluded.length }}</strong>
            @if (keptCount() > 0) {
              · <span class="warn">{{ keptCount() }} kept because they hold your data</span>
            }
          </summary>
          <ul class="excluded">
            @for (x of d.excluded; track x.haDeviceId) {
              <li>
                <span>{{ x.name }}</span>
                <span class="muted small">{{ x.reason }}</span>
                @if (x.keptLocalId) {
                  <a class="warn small" [routerLink]="['/devices', x.keptLocalId]">
                    kept — {{ x.keptBecause ?? 'still in inventory' }}
                  </a>
                }
              </li>
            }
          </ul>
          <p class="muted small">
            Built-in virtual integrations: {{ d.builtInVirtualIntegrations.join(', ') }}.
          </p>
        </details>
      } @else {
        <p class="muted small">Loading…</p>
      }
    </div>
  `,
  styles: `
    h4 {
      margin: 12px 0 6px;
    }
    .small {
      font-size: 0.85em;
    }
    .add {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 10px 0 4px;
    }
    .add input {
      flex: 1;
      min-width: 160px;
    }
    .row-actions {
      text-align: right;
    }
    details {
      margin-top: 12px;
    }
    summary {
      cursor: pointer;
    }
    .excluded {
      list-style: none;
      padding: 0;
      margin: 8px 0;
      max-height: 40vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .excluded li {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: baseline;
    }
    .warn {
      color: var(--warning-color, #f9a825);
    }
  `,
})
export class SyncExclusionsComponent implements OnInit {
  private readonly api = inject(HaApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly confirmSkipped = signal(this.confirm.isSkipped('exclude-device'));

  protected resetConfirm(): void {
    this.confirm.resetSkipped();
    this.confirmSkipped.set(false);
  }

  protected readonly icons = { delete: mdiDelete };
  protected readonly data = signal<SyncExclusionsDto | null>(null);
  protected readonly busy = signal(false);
  protected readonly keptCount = computed(
    () => this.data()?.excluded.filter((x) => x.keptLocalId).length ?? 0
  );

  protected kind: Exclude<SyncExclusionKind, 'device'> = 'manufacturer';
  protected value = '';

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.exclusions().subscribe({
      next: (d) => this.data.set(d),
      error: () => this.data.set(null),
    });
  }

  protected add(): void {
    const value = this.value.trim();
    if (!value) return;
    this.busy.set(true);
    this.api.addExclusion({ kind: this.kind, value }).subscribe({
      next: ({ sync }) => {
        this.busy.set(false);
        this.value = '';
        const x = sync.excluded;
        this.toast.success(
          x ? `Excluded — ${x.removed} removed from the inventory${x.kept ? `, ${x.kept} kept` : ''}` : 'Rule added'
        );
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }

  protected async remove(id: string): Promise<void> {
    const ok = await this.confirm.ask(
      'Remove this rule? Matching devices will be synced back into the inventory.',
      { confirmLabel: 'Remove' }
    );
    if (!ok) return;
    this.busy.set(true);
    this.api.removeExclusion(id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('Rule removed — devices restored');
        this.load();
      },
      error: () => this.busy.set(false),
    });
  }
}
