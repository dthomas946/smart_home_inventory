import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  CreateUtilityProviderDto,
  UTILITY_LABELS,
  UtilityKind,
  UtilityProviderDto,
  UtilitySummaryDto,
} from '@smart-home-inventory/shared';
import {
  mdiAlertOctagonOutline,
  mdiDelete,
  mdiEmailOutline,
  mdiFileDocumentOutline,
  mdiFire,
  mdiFlash,
  mdiMapOutline,
  mdiOpenInNew,
  mdiPencil,
  mdiPhone,
  mdiPhoneClassic,
  mdiPlus,
  mdiSolarPower,
  mdiWater,
  mdiWeb,
} from '@mdi/js';
import { DiagramsApi, UtilitiesApi } from '../../core/api/api.services';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ConnectionTypesStore } from '../../core/connection-types/connection-types.store';
import { ToastService } from '../../core/toast/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';

const ICONS: Record<UtilityKind, string> = {
  electrical: mdiFlash,
  gas: mdiFire,
  water: mdiWater,
  phone: mdiPhoneClassic,
  internet: mdiWeb,
  solar: mdiSolarPower,
};

const HINTS: Record<UtilityKind, string> = {
  electrical:
    'Add your panel as a device and connect each breaker to what it feeds (120V / 240V). Breaker number, amps and the areas a circuit serves go on the connection.',
  gas: 'Meter → shut-off → furnace, water heater, range, dryer, fireplace.',
  water: 'Meter / well → main shut-off → softener, water heater, fixtures (cold, hot, waste).',
  phone: 'Phone line from the provider\'s box to handsets, alarm panel or fax.',
  internet: 'Modem / ONT → router → switches and access points (fiber, coax, Ethernet, Wi-Fi).',
  solar: 'Panels → inverter → panel / battery (Solar DC, then 120V / 240V).',
};

type ProviderForm = Omit<CreateUtilityProviderDto, 'utility'> & { utility: UtilityKind };

function emptyForm(utility: UtilityKind): ProviderForm {
  return {
    utility,
    name: '',
    accountNumber: '',
    phone: '',
    emergencyPhone: '',
    email: '',
    website: '',
    outageUrl: '',
    notes: '',
  };
}

/** Utilities: who supplies each one, how to reach them, and its maps/plans. */
@Component({
  selector: 'app-utilities-page',
  imports: [FormsModule, RouterLink, IconComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Utilities</h1>
    <p class="muted intro">
      Service providers and contacts for each utility, a map of how it runs
      through the house (built from your connections), and hand-drawn plans.
    </p>

    <div class="grid">
      @for (u of utilities(); track u.utility) {
        <section class="card util" [id]="u.utility">
          <header>
            <app-icon [path]="icons[u.utility]" [size]="22" />
            <h2>{{ labels[u.utility] }}</h2>
            <a
              class="btn secondary small"
              [routerLink]="['/network']"
              [queryParams]="{ map: u.utility }"
              [title]="'Network map filtered to ' + labels[u.utility]"
            >
              <app-icon [path]="icons.map" [size]="16" /> Map
              <span class="muted">{{ u.connectionCount }}</span>
            </a>
          </header>

          <h3>Providers</h3>
          @for (p of u.providers; track p.id) {
            @if (editingId() === p.id) {
              <ng-container *ngTemplateOutlet="formTpl" />
            } @else {
              <div class="provider">
                <div class="p-head">
                  <strong>{{ p.name }}</strong>
                  <span class="spacer"></span>
                  <button class="btn icon-only" title="Edit" (click)="edit(p)">
                    <app-icon [path]="icons.edit" [size]="16" />
                  </button>
                  <button class="btn icon-only" title="Delete" (click)="remove(p)">
                    <app-icon [path]="icons.delete" [size]="16" />
                  </button>
                </div>
                @if (p.accountNumber) {
                  <div class="muted small">Account {{ p.accountNumber }}</div>
                }
                <div class="contacts">
                  @if (p.phone) {
                    <a [href]="'tel:' + p.phone"><app-icon [path]="icons.phone" [size]="14" /> {{ p.phone }}</a>
                  }
                  @if (p.emergencyPhone) {
                    <a class="emergency" [href]="'tel:' + p.emergencyPhone" title="Outage / emergency">
                      <app-icon [path]="icons.emergency" [size]="14" /> {{ p.emergencyPhone }}
                    </a>
                  }
                  @if (p.email) {
                    <a [href]="'mailto:' + p.email"><app-icon [path]="icons.email" [size]="14" /> {{ p.email }}</a>
                  }
                  @if (p.website) {
                    <a [href]="href(p.website)" target="_blank" rel="noopener">
                      <app-icon [path]="icons.web" [size]="14" /> Website
                    </a>
                  }
                  @if (p.outageUrl) {
                    <a [href]="href(p.outageUrl)" target="_blank" rel="noopener">
                      <app-icon [path]="icons.open" [size]="14" /> Outages
                    </a>
                  }
                </div>
                @if (p.notes) {
                  <p class="notes">{{ p.notes }}</p>
                }
              </div>
            }
          } @empty {
            @if (addingTo() !== u.utility) {
              <p class="muted small">No provider yet.</p>
            }
          }
          @if (addingTo() === u.utility) {
            <ng-container *ngTemplateOutlet="formTpl" />
          } @else if (!editingId()) {
            <button class="btn secondary small" (click)="add(u.utility)">
              <app-icon [path]="icons.add" [size]="16" /> Add provider
            </button>
          }

          <h3>Plans</h3>
          <div class="plans">
            @for (d of u.diagrams; track d.id) {
              <a class="chip" [routerLink]="['/diagrams']" [queryParams]="{ utility: u.utility, open: d.id }">
                <app-icon [path]="icons.plan" [size]="14" /> {{ d.title }}
              </a>
            }
            <button class="btn secondary small" (click)="newPlan(u.utility)">
              <app-icon [path]="icons.add" [size]="16" /> New plan
            </button>
          </div>

          <p class="hint">{{ hints[u.utility] }}</p>
          @if (typeLabels(u).length) {
            <p class="hint">Map shows: {{ typeLabels(u).join(', ') }} · change in Settings → Connection types.</p>
          }
        </section>
      }
    </div>

    <ng-template #formTpl>
      <form class="pform" (ngSubmit)="save()">
        <input class="text" name="name" placeholder="Provider (e.g. Entergy, CenterPoint, AT&T)" [(ngModel)]="form.name" required />
        <input class="text" name="acct" placeholder="Account number" [(ngModel)]="form.accountNumber" />
        <input class="text" name="phone" placeholder="Customer service phone" [(ngModel)]="form.phone" />
        <input class="text" name="eph" placeholder="Outage / emergency phone" [(ngModel)]="form.emergencyPhone" />
        <input class="text" name="email" type="email" placeholder="Email" [(ngModel)]="form.email" />
        <input class="text" name="web" placeholder="Website" [(ngModel)]="form.website" />
        <input class="text" name="out" placeholder="Outage map / status page" [(ngModel)]="form.outageUrl" />
        <textarea class="text" name="notes" rows="2" placeholder="Notes (meter number, plan, contract end…)" [(ngModel)]="form.notes"></textarea>
        <div class="actions">
          <button type="button" class="btn secondary" (click)="cancel()">Cancel</button>
          <button type="submit" class="btn" [disabled]="!form.name.trim()">Save</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: `
    .intro { margin-top: -4px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .util header { display: flex; align-items: center; gap: 8px; }
    .util h2 { margin: 0; font-size: 1.2em; flex: 1; }
    .util h3 {
      margin: 14px 0 6px;
      font-size: 0.8em;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--secondary-text-color);
    }
    .small { padding: 3px 10px; font-size: 0.85em; }
    .provider {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 8px 10px;
      margin-bottom: 8px;
    }
    .p-head { display: flex; align-items: center; gap: 4px; }
    .spacer { flex: 1; }
    .contacts { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 0.9em; }
    .contacts a { display: inline-flex; align-items: center; gap: 4px; color: var(--primary-color); text-decoration: none; }
    .contacts a.emergency { color: var(--error-color, #e53935); }
    .notes { margin: 6px 0 0; font-size: 0.85em; white-space: pre-wrap; }
    .plans { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .plans .chip { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
    .hint { margin: 10px 0 0; font-size: 0.8em; color: var(--secondary-text-color); }
    .pform { display: grid; gap: 6px; margin-bottom: 8px; }
    .pform .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .icon-only { padding: 2px; }
  `,
})
export class UtilitiesPageComponent implements OnInit {
  private readonly api = inject(UtilitiesApi);
  private readonly diagramsApi = inject(DiagramsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly connectionTypes = inject(ConnectionTypesStore);

  protected readonly labels = UTILITY_LABELS;
  protected readonly hints = HINTS;
  protected readonly icons = {
    ...ICONS,
    map: mdiMapOutline,
    edit: mdiPencil,
    delete: mdiDelete,
    add: mdiPlus,
    phone: mdiPhone,
    emergency: mdiAlertOctagonOutline,
    email: mdiEmailOutline,
    web: mdiWeb,
    open: mdiOpenInNew,
    plan: mdiFileDocumentOutline,
  };
  protected readonly utilities = signal<UtilitySummaryDto[]>([]);
  protected readonly addingTo = signal<UtilityKind | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected form: ProviderForm = emptyForm('electrical');

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.api.list().subscribe((u) => {
      this.utilities.set(u);
      const frag = this.router.parseUrl(this.router.url).fragment;
      if (frag) queueMicrotask(() => document.getElementById(frag)?.scrollIntoView({ block: 'start' }));
    });
  }

  protected typeLabels(u: UtilitySummaryDto): string[] {
    return u.connectionTypes.map((k) => this.connectionTypes.label(k));
  }

  protected href(url: string): string {
    return /^https?:\/\//i.test(url) ? url : `https://${url}`;
  }

  protected add(utility: UtilityKind): void {
    this.editingId.set(null);
    this.form = emptyForm(utility);
    this.addingTo.set(utility);
  }

  protected edit(p: UtilityProviderDto): void {
    this.addingTo.set(null);
    this.form = {
      utility: p.utility,
      name: p.name,
      accountNumber: p.accountNumber ?? '',
      phone: p.phone ?? '',
      emergencyPhone: p.emergencyPhone ?? '',
      email: p.email ?? '',
      website: p.website ?? '',
      outageUrl: p.outageUrl ?? '',
      notes: p.notes ?? '',
    };
    this.editingId.set(p.id);
  }

  protected cancel(): void {
    this.addingTo.set(null);
    this.editingId.set(null);
  }

  protected save(): void {
    const id = this.editingId();
    const req = id ? this.api.updateProvider(id, this.form) : this.api.createProvider(this.form);
    req.subscribe(() => {
      this.toast.success(`Saved ${this.form.name}`);
      this.cancel();
      this.load();
    });
  }

  protected async remove(p: UtilityProviderDto): Promise<void> {
    const ok = await this.confirm.ask(`Delete provider "${p.name}"?`, { confirmLabel: 'Delete' });
    if (!ok) return;
    this.api.removeProvider(p.id).subscribe(() => this.load());
  }

  protected newPlan(utility: UtilityKind): void {
    const existing = this.utilities().find((u) => u.utility === utility)?.diagrams.length ?? 0;
    const title = `${UTILITY_LABELS[utility]} plan${existing ? ` ${existing + 1}` : ''}`;
    this.diagramsApi.create({ title, utility }).subscribe((d) => {
      this.router.navigate(['/diagrams'], { queryParams: { utility, open: d.id } });
    });
  }
}
