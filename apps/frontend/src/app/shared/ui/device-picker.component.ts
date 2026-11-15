import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DeviceCategory, DeviceDto } from '@smart-home-inventory/shared';
import { DevicesApi } from '../../core/api/api.services';
import { ToastService } from '../../core/toast/toast.service';

/** Name → category guess for devices created on the fly from the picker,
 *  which are mostly power sources and other non-smart infrastructure. */
function guessCategory(name: string): DeviceCategory | null {
  if (/panel|breaker|fuse|load cent(er|re)|disconnect|sub-?panel/i.test(name)) return 'breaker';
  if (/junction|j-?box/i.test(name)) return 'junction_box';
  if (/outlet|receptacle|socket/i.test(name)) return 'outlet';
  if (/\bhub\b|bridge|coordinator/i.test(name)) return 'hub';
  if (/router|network switch|access point|\bap\b|modem|gateway/i.test(name)) return 'network';
  if (/thermostat/i.test(name)) return 'thermostat';
  if (/water heater/i.test(name)) return 'water_heater';
  if (/pump/i.test(name)) return 'pump';
  return null;
}

/** Lightweight autocomplete for picking a device. With `allowCreate`, a
 *  name that doesn't exist can be created on the spot (a breaker, a 24V
 *  transformer, a junction box) — the endpoint you need often isn't a
 *  smart device and isn't in the inventory yet. */
@Component({
  selector: 'app-device-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker">
      <input
        class="text"
        type="text"
        [placeholder]="placeholder()"
        [value]="query()"
        (input)="onQuery($event)"
        (focus)="search(query())"
        (blur)="onBlur()"
      />
      @if (open() && (results().length > 0 || canCreate())) {
        <ul class="results card">
          @for (device of results(); track device.id) {
            <li (mousedown)="pick(device)">
              <span>{{ device.name }}</span>
              @if (device.areaName) {
                <span class="muted">{{ device.areaName }}</span>
              }
            </li>
          }
          @if (canCreate()) {
            <li class="create" (mousedown)="create()">
              <span>+ Create “{{ query().trim() }}”</span>
              <span class="muted">new device</span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .picker {
      position: relative;
    }
    .results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 20;
      list-style: none;
      margin: 0;
      padding: 4px;
      max-height: min(60vh, 420px);
      overflow: auto;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    li {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    li:hover {
      background: var(--hover-color);
    }
    li.create {
      border-top: 1px solid var(--divider-color);
      color: var(--primary-color);
      font-weight: 500;
    }
  `,
})
export class DevicePickerComponent {
  private readonly devicesApi = inject(DevicesApi);
  private readonly toast = inject(ToastService);

  readonly placeholder = input('Search device…');
  /** Device ids to exclude from results (e.g. the other endpoint). */
  readonly exclude = input<string[]>([]);
  /** Area id whose devices should be sorted to the top of the results. */
  readonly currentAreaId = input<string | null>(null);
  /** Empties the search box on pick instead of filling it with the picked
   *  device's name — for callers that close/reset around each pick (so a
   *  lingering name would otherwise resurface, confusingly, on next use)
   *  rather than keeping the picker visible as a record of the selection. */
  readonly clearOnSelect = input(false);
  /** Offer "+ Create …" when the typed name has no exact match. */
  readonly allowCreate = input(false);
  readonly selected = output<DeviceDto>();

  protected readonly query = signal('');
  protected readonly results = signal<DeviceDto[]>([]);
  protected readonly open = signal(false);
  private creating = false;

  protected canCreate(): boolean {
    if (!this.allowCreate()) return false;
    const q = this.query().trim().toLowerCase();
    return q.length >= 2 && !this.results().some((d) => d.name.trim().toLowerCase() === q);
  }

  protected create(): void {
    const name = this.query().trim();
    if (!name || this.creating) return;
    this.creating = true;
    this.devicesApi
      .create({
        name,
        status: 'installed',
        category: guessCategory(name),
        areaId: this.currentAreaId() ?? null,
      })
      .subscribe({
        next: (device) => {
          this.creating = false;
          this.toast.success(`Created device “${device.name}”`);
          this.pick(device);
        },
        error: () => (this.creating = false),
      });
  }

  protected onQuery(event: Event): void {
    const q = (event.target as HTMLInputElement).value;
    this.query.set(q);
    this.search(q);
  }

  protected search(q: string): void {
    this.devicesApi.list({ q: q || undefined }).subscribe((devices) => {
      const areaId = this.currentAreaId();
      const filtered = devices.filter((d) => !this.exclude().includes(d.id));
      if (areaId) {
        filtered.sort(
          (a, b) => Number(b.areaId === areaId) - Number(a.areaId === areaId)
        );
      }
      this.results.set(filtered.slice(0, 40));
      this.open.set(true);
    });
  }

  protected onBlur(): void {
    // Delay so mousedown on a result fires first.
    setTimeout(() => this.open.set(false), 150);
  }

  protected pick(device: DeviceDto): void {
    this.query.set(this.clearOnSelect() ? '' : device.name);
    this.open.set(false);
    this.selected.emit(device);
  }
}
