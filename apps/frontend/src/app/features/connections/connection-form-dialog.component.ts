import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AreaDto, circuitOf, CircuitDto, ConnectionDto, ConnectionType, DeviceDto } from '@smart-home-inventory/shared';
import { mdiSwapHorizontal } from '@mdi/js';
import { AreasApi, ConnectionsApi } from '../../core/api/api.services';
import { ConnectionTypesStore } from '../../core/connection-types/connection-types.store';
import { ToastService } from '../../core/toast/toast.service';
import { DevicePickerComponent } from '../../shared/ui/device-picker.component';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * Create a connection. `fixedDevice` (when opened from a device page) becomes
 * one endpoint; direction is chosen with the from/to toggle. `fixedPair`
 * (opened from a diagram edge whose two ends are both device-linked) fixes
 * both ends and their direction outright — nothing left to pick.
 */
@Component({
  selector: 'app-connection-form-dialog',
  imports: [FormsModule, DevicePickerComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (cancel)="closed.emit()">
      <h3>{{ editing() ? 'Edit connection' : 'New connection' }}</h3>
      @if (editingAuto()) {
        <p class="auto-note">
          This link was created by auto-link. Saving changes makes it a manual link — re-runs
          won't change or remove it.
        </p>
      }
      <form (ngSubmit)="save()">
        <label class="field">
          <span>Type *</span>
          <select class="text" name="type" [(ngModel)]="type">
            @for (group of connectionTypes.groups(); track group.group) {
              <optgroup [label]="group.label">
                @for (t of group.types; track t.key) {
                  <option [value]="t.key">{{ t.label }}</option>
                }
              </optgroup>
            }
          </select>
        </label>

        @if (editing()) {
          <div class="field">
            <span>From device (upstream)</span>
            @if (changingEnd() === 'from') {
              <app-device-picker
                [allowCreate]="true"
                [exclude]="[editTo().id]"
                (selected)="editFrom.set({ id: $event.id, name: $event.name }); changingEnd.set(null)"
              />
            } @else {
              <div class="pair-row">
                <div class="value">{{ editFrom().name }}</div>
                <button type="button" class="btn secondary small-btn" (click)="changingEnd.set('from')">Change</button>
              </div>
            }
          </div>
          <div class="swap-row">
            <button type="button" class="btn icon-only" title="Swap direction" (click)="swapEdit()">
              <app-icon [path]="icons.swap" [size]="16" />
            </button>
          </div>
          <div class="field">
            <span>To device</span>
            @if (changingEnd() === 'to') {
              <app-device-picker
                [allowCreate]="true"
                [exclude]="[editFrom().id]"
                (selected)="editTo.set({ id: $event.id, name: $event.name }); changingEnd.set(null)"
              />
            } @else {
              <div class="pair-row">
                <div class="value">{{ editTo().name }}</div>
                <button type="button" class="btn secondary small-btn" (click)="changingEnd.set('to')">Change</button>
              </div>
            }
          </div>
        } @else if (effectivePair(); as pair) {
          <div class="field">
            <span>Connection</span>
            <div class="pair-row">
              <div class="value">{{ pair.from.name }} → {{ pair.to.name }}</div>
              <button type="button" class="btn icon-only" title="Turn around" (click)="swapped.set(!swapped())">
                <app-icon [path]="icons.swap" [size]="16" />
              </button>
            </div>
          </div>
        } @else if (fixedDevice(); as fixed) {
          <label class="field">
            <span>Direction</span>
            <select class="text" name="direction" [(ngModel)]="fixedIsSource">
              <option [ngValue]="true">{{ fixed.name }} → other device</option>
              <option [ngValue]="false">other device → {{ fixed.name }}</option>
            </select>
          </label>
          <div class="field">
            <span>Other device *</span>
            <app-device-picker
                [allowCreate]="true"
              [exclude]="[fixed.id]"
              [currentAreaId]="fixed.areaId"
              (selected)="otherDevice.set($event)"
            />
          </div>
        } @else {
          <div class="field">
            <span>From device (upstream) *</span>
            <app-device-picker
                [allowCreate]="true"
              [exclude]="otherDevice() ? [otherDevice()!.id] : []"
              [currentAreaId]="otherDevice()?.areaId ?? null"
              (selected)="sourceDevice.set($event)"
            />
          </div>
          <div class="field">
            <span>To device *</span>
            <app-device-picker
                [allowCreate]="true"
              [exclude]="sourceDevice() ? [sourceDevice()!.id] : []"
              [currentAreaId]="sourceDevice()?.areaId ?? null"
              (selected)="otherDevice.set($event)"
            />
          </div>
        }

        @if (isElectrical()) {
          <fieldset class="circuit">
            <legend>Circuit</legend>
            <div class="circuit-row">
              <label class="field">
                <span>Breaker #</span>
                <input class="text" name="breaker" [(ngModel)]="circuit.breaker" placeholder="12 or 12/14" />
              </label>
              <label class="field">
                <span>Amps</span>
                <input class="text" name="amps" type="number" min="1" max="1000" [(ngModel)]="circuit.amps" placeholder="20" />
              </label>
              <label class="field">
                <span>Poles</span>
                <select class="text" name="poles" [(ngModel)]="circuit.poles">
                  <option [ngValue]="null">—</option>
                  <option [ngValue]="1">1 (120 V)</option>
                  <option [ngValue]="2">2 (240 V)</option>
                  <option [ngValue]="3">3 (3-phase)</option>
                </select>
              </label>
            </div>
            <label class="field">
              <span>Area served</span>
              <select class="text" name="servesArea" [(ngModel)]="circuitArea">
                <option value="">— the connected device's area —</option>
                @for (a of areas(); track a.id) {
                  <option [value]="a.id">{{ a.name }}</option>
                }
              </select>
            </label>
            <label class="field">
              <span>Serves (details)</span>
              <input class="text" name="serves" [(ngModel)]="circuit.serves" placeholder="e.g. Kitchen counter outlets, bath GFCI" />
            </label>
          </fieldset>
        }

        <label class="field">
          <span>Label</span>
          <input
            class="text"
            name="label"
            [(ngModel)]="label"
            placeholder="e.g. L2 / F7, Port 12, OnOff cluster"
          />
        </label>
        <label class="field">
          <span>Notes</span>
          <textarea class="text" name="notes" rows="2" [(ngModel)]="notes"></textarea>
        </label>

        <div class="actions">
          <button type="button" class="btn secondary" (click)="closed.emit()">
            Cancel
          </button>
          <button type="submit" class="btn" [disabled]="!canSave() || saving()">
            {{ editing() ? 'Save' : 'Create' }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .circuit {
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      padding: 6px 10px 2px;
      margin: 0 0 12px;
    }
    .circuit legend {
      font-size: 0.85em;
      color: var(--secondary-text-color);
      padding: 0 4px;
    }
    .circuit-row {
      display: grid;
      grid-template-columns: 1fr 1fr 1.2fr;
      gap: 8px;
    }
    .value {
      font-size: 13px;
      color: var(--primary-text-color);
    }
    .pair-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .auto-note {
      font-size: 0.85em;
      margin: 0 0 12px;
      padding: 8px 10px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--primary-color) 14%, transparent);
    }
    .swap-row {
      display: flex;
      justify-content: center;
      margin: -6px 0 2px;
    }
    .small-btn {
      padding: 2px 10px;
      font-size: 12px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
  `,
})
export class ConnectionFormDialogComponent {
  private readonly api = inject(ConnectionsApi);
  private readonly areasApi = inject(AreasApi);
  protected readonly areas = signal<AreaDto[]>([]);
  /** Electrical circuit details (breaker, amps, area served). */
  protected circuit: { breaker: string; amps: number | null; poles: 1 | 2 | 3 | null; serves: string } = {
    breaker: '',
    amps: null,
    poles: null,
    serves: '',
  };
  protected circuitArea = '';
  private readonly toast = inject(ToastService);
  protected readonly connectionTypes = inject(ConnectionTypesStore);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly open = input(false);
  readonly fixedDevice = input<DeviceDto | null>(null);
  readonly fixedPair = input<{ from: DeviceDto; to: DeviceDto } | null>(null);
  /** Pre-fills the label, e.g. with the diagram edge/wire's own label. */
  readonly initialLabel = input('');
  /** Pre-fills the type, e.g. with the diagram edge/wire's own type. */
  readonly initialType = input<ConnectionType | ''>('');
  /** Start with the fixed device as the upstream end (e.g. "controls"). */
  readonly fixedAsSource = input(false);
  /** When set, the dialog edits this connection instead of creating one. */
  readonly editing = input<ConnectionDto | null>(null);
  readonly closed = output<void>();
  readonly saved = output<ConnectionDto>();

  protected readonly icons = { swap: mdiSwapHorizontal };
  protected type: ConnectionType = '';
  protected fixedIsSource = false;
  protected label = '';
  protected notes = '';
  protected readonly sourceDevice = signal<DeviceDto | null>(null);
  protected readonly otherDevice = signal<DeviceDto | null>(null);
  protected readonly saving = signal(false);
  /** Only meaningful when fixedPair() is set — lets a fixed pair's direction
   *  be turned around, since the diagram edge it came from might be drawn
   *  the opposite way from the real upstream/downstream relationship. */
  protected readonly swapped = signal(false);

  // Edit mode state
  protected readonly editFrom = signal<{ id: string; name: string }>({ id: '', name: '' });
  protected readonly editTo = signal<{ id: string; name: string }>({ id: '', name: '' });
  protected readonly changingEnd = signal<'from' | 'to' | null>(null);
  protected readonly editingAuto = computed(() => this.editing()?.metadata?.['auto'] === true);

  protected readonly effectivePair = computed(() => {
    const pair = this.fixedPair();
    if (!pair) return null;
    return this.swapped() ? { from: pair.to, to: pair.from } : pair;
  });

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      const editing = this.editing();
      if (this.open() && editing) {
        this.type = editing.type;
        this.label = editing.label ?? '';
        this.notes = editing.notes ?? '';
        this.loadCircuit(circuitOf(editing.metadata));
        this.editFrom.set({ id: editing.fromDeviceId, name: editing.fromDeviceName });
        this.editTo.set({ id: editing.toDeviceId, name: editing.toDeviceName });
        this.changingEnd.set(null);
        if (!el.open) el.showModal();
      } else if (this.open()) {
        this.type = this.initialType() || this.connectionTypes.types()[0]?.key || '';
        this.fixedIsSource = this.fixedAsSource();
        this.label = this.initialLabel();
        this.notes = '';
        this.loadCircuit(null);
        this.sourceDevice.set(null);
        this.otherDevice.set(null);
        this.swapped.set(false);
        if (!el.open) el.showModal();
      } else if (el.open) {
        el.close();
      }
    });
  }

  protected isElectrical(): boolean {
    return this.connectionTypes.byKey()[this.type]?.utility === 'electrical';
  }

  private loadCircuit(c: CircuitDto | null): void {
    this.circuit = {
      breaker: c?.breaker ?? '',
      amps: c?.amps ?? null,
      poles: (c?.poles as 1 | 2 | 3 | null | undefined) ?? null,
      serves: c?.serves ?? '',
    };
    this.circuitArea = c?.servesAreaIds?.[0] ?? '';
    if (this.areas().length === 0) this.areasApi.list().subscribe((a) => this.areas.set(a));
  }

  /** Metadata to send: the circuit merged into what's already there (only
   *  for electrical types; anything else leaves metadata untouched). */
  private metadataFor(current: Record<string, unknown> | null): Record<string, unknown> | undefined {
    if (!this.isElectrical()) return undefined;
    const amps = Number(this.circuit.amps);
    const circuit: CircuitDto = {
      breaker: this.circuit.breaker.trim() || null,
      amps: Number.isFinite(amps) && amps > 0 ? amps : null,
      poles: this.circuit.poles,
      servesAreaIds: this.circuitArea ? [this.circuitArea] : null,
      serves: this.circuit.serves.trim() || null,
    };
    const empty = !circuit.breaker && !circuit.amps && !circuit.poles && !circuit.servesAreaIds && !circuit.serves;
    const base = { ...(current ?? {}) };
    if (empty) {
      if (!('circuit' in base)) return undefined;
      delete base['circuit'];
      return base;
    }
    return { ...base, circuit };
  }

  protected swapEdit(): void {
    const from = this.editFrom();
    this.editFrom.set(this.editTo());
    this.editTo.set(from);
  }

  protected canSave(): boolean {
    if (!this.type) return false;
    if (this.editing()) return this.editFrom().id !== this.editTo().id && this.changingEnd() === null;
    if (this.fixedPair()) return true;
    if (this.fixedDevice()) return this.otherDevice() !== null;
    return this.sourceDevice() !== null && this.otherDevice() !== null;
  }

  protected save(): void {
    const editing = this.editing();
    if (editing) {
      this.saveEdit(editing);
      return;
    }
    let fromDeviceId: string;
    let toDeviceId: string;
    const pair = this.effectivePair();
    const fixed = this.fixedDevice();
    const other = this.otherDevice();
    if (pair) {
      fromDeviceId = pair.from.id;
      toDeviceId = pair.to.id;
    } else if (fixed) {
      if (!other) return;
      fromDeviceId = this.fixedIsSource ? fixed.id : other.id;
      toDeviceId = this.fixedIsSource ? other.id : fixed.id;
    } else {
      const source = this.sourceDevice();
      if (!source || !other) return;
      fromDeviceId = source.id;
      toDeviceId = other.id;
    }
    this.saving.set(true);
    this.api
      .create({
        type: this.type,
        fromDeviceId,
        toDeviceId,
        label: this.label.trim() || null,
        notes: this.notes.trim() || null,
        ...(this.metadataFor(null) ? { metadata: this.metadataFor(null) } : {}),
      })
      .subscribe({
        next: (connection) => {
          this.saving.set(false);
          this.toast.success('Connection created');
          this.saved.emit(connection);
        },
        error: () => this.saving.set(false),
      });
  }

  private saveEdit(current: ConnectionDto): void {
    const from = this.editFrom().id;
    const to = this.editTo().id;
    const label = this.label.trim() || null;
    const notes = this.notes.trim() || null;
    this.saving.set(true);
    this.api
      .update(current.id, {
        ...(this.type !== current.type ? { type: this.type } : {}),
        ...(from !== current.fromDeviceId ? { fromDeviceId: from } : {}),
        ...(to !== current.toDeviceId ? { toDeviceId: to } : {}),
        label,
        notes,
        ...(this.metadataFor(current.metadata) !== undefined ? { metadata: this.metadataFor(current.metadata) } : {}),
      })
      .subscribe({
        next: (connection) => {
          this.saving.set(false);
          this.toast.success(this.editingAuto() ? 'Connection saved — now manual' : 'Connection saved');
          this.saved.emit(connection);
        },
        error: () => this.saving.set(false),
      });
  }
}
