import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { readCodes } from '../../core/scan/read-codes';
import { Router } from '@angular/router';
import {
  AreaDto,
  CapabilityTypeDto,
  CreateDeviceDto,
  DEVICE_CATEGORIES,
  DEVICE_STATUSES,
  DeviceCategory,
  DeviceDetailDto,
  LabelScanResultDto,
} from '@smart-home-inventory/shared';
import { mdiCameraOutline, mdiClose, mdiUploadOutline } from '@mdi/js';
import {
  AreasApi,
  AttachmentsApi,
  CapabilitiesApi,
  DevicesApi,
  LabelScanApi,
} from '../../core/api/api.services';
import { ToastService } from '../../core/toast/toast.service';
import { LocaleStore } from '../../core/locale/locale.store';
import { NEW_DEVICE, ReturnStore } from '../../core/navigation/return.store';
import { IconComponent } from '../../shared/ui/icon.component';

/** Re-encode an image so its longest edge is at most `maxEdge` px (JPEG).
 *  Returns the original when it is already small enough or can't be decoded. */
async function downscaleImage(file: File, maxEdge: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9)
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}

@Component({
  selector: 'app-device-form-page',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-head">
      <h1>{{ deviceId() ? 'Edit device' : 'New device' }}</h1>
      @if (scanEnabled() || codesEnabled()) {
        <div class="scan-actions">
          <button
            type="button"
            class="btn secondary"
            [disabled]="scanning()"
            (click)="cameraInput.click()"
            [title]="scanEnabled()
              ? 'Photograph the rating label or its QR code; the AI and the code fill in the fields'
              : 'Photograph the QR code or barcode on the device (reading label text needs an AI in Settings)'"
          >
            <app-icon [path]="icons.camera" [size]="18" />
            {{ scanning() ? 'Reading label…' : scanEnabled() ? 'Take photo' : 'Scan QR code' }}
          </button>
          <button
            type="button"
            class="btn secondary"
            [disabled]="scanning()"
            (click)="uploadInput.click()"
            title="Pick an existing photo of the rating label or QR code"
          >
            <app-icon [path]="icons.upload" [size]="18" /> {{ scanEnabled() ? 'Upload photo' : 'Upload QR photo' }}
          </button>
        </div>
        <input
          #cameraInput
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          (change)="onLabelPicked($event)"
        />
        <input #uploadInput type="file" accept="image/*" hidden (change)="onLabelPicked($event)" />
      }
    </div>

    @if (scanning()) {
      <div class="card scan-banner">
        <span class="spinner"></span>
        @if (scanCodes().length) {
          Found {{ scanCodes().length === 1 ? 'a code' : scanCodes().length + ' codes' }} on the label.
        }
        @if (scanEnabled()) {
          Reading the label with {{ scanModel() }} — on a local GPU this can take a minute or two.
        } @else {
          Looking it up…
        }
      </div>
    }
    @if (scanResult(); as r) {
      <div class="card scan-banner result">
        <div class="scan-head">
          <strong>Read from label</strong>
          <span class="muted">({{ r.model }}, {{ (r.durationMs / 1000).toFixed(0) }}s)</span>
          <button type="button" class="btn icon-only" title="Dismiss" (click)="scanResult.set(null)">
            <app-icon [path]="icons.close" [size]="16" />
          </button>
        </div>
        <div class="chips">
          @for (chip of scanChips(); track chip) {
            <span class="chip">{{ chip }}</span>
          }
        </div>
        @if (scanConflicts().length > 0) {
          <p class="muted small">
            Kept your existing value for: {{ scanConflicts().join(', ') }}. Edit below if the
            label is right.
          </p>
        }
        <p class="muted small">
          Review before saving — the photo will be attached to the device as "Rating label".
        </p>
      </div>
    }

    <form class="card" (ngSubmit)="save()">
      <div class="grid">
        <label class="field span2">
          <span>Name *</span>
          <input class="text" name="name" [(ngModel)]="model.name" required />
        </label>
        <label class="field">
          <span>Category</span>
          <select class="text" name="category" [(ngModel)]="model.category">
            <option [ngValue]="null">—</option>
            @for (cat of categories; track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Status</span>
          <select class="text" name="status" [(ngModel)]="model.status">
            @for (status of statuses; track status) {
              <option [value]="status">{{ status }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Area</span>
          <select class="text" name="areaId" [(ngModel)]="model.areaId">
            <option [ngValue]="null">—</option>
            @for (area of areas(); track area.id) {
              <option [value]="area.id">{{ area.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Manufacturer</span>
          <input
            class="text"
            name="manufacturer"
            placeholder="As printed on the plate, e.g. Electrolux Home Products"
            [(ngModel)]="model.manufacturer"
          />
        </label>
        <label class="field">
          <span>Brand <span class="muted">(if different)</span></span>
          <input
            class="text"
            name="brand"
            placeholder="e.g. Frigidaire — used for parts & manual lookups"
            [(ngModel)]="model.brand"
          />
        </label>
        <label class="field">
          <span>Model</span>
          <input class="text" name="modelName" [(ngModel)]="model.model" />
        </label>
        <label class="field">
          <span>Serial number</span>
          <input class="text" name="serialNumber" [(ngModel)]="model.serialNumber" />
        </label>
        <label class="field span2">
          <span>Product link</span>
          <input
            class="text"
            name="productUrl"
            type="url"
            placeholder="https://…"
            [(ngModel)]="model.productUrl"
          />
        </label>
        <label class="field">
          <span>Purchase date</span>
          <input class="text" name="purchaseDate" type="date" [(ngModel)]="purchaseDate" />
        </label>
        <label class="field">
          <span>Price ({{ localeStore.symbol(currency) }})</span>
          <input
            class="text"
            name="price"
            type="number"
            step="0.01"
            min="0"
            [(ngModel)]="priceEuros"
          />
        </label>
        <label class="field">
          <span>Purchased from</span>
          <input class="text" name="purchasedFrom" [(ngModel)]="model.purchasedFrom" />
        </label>
        <label class="field span2">
          <span>Notes</span>
          <textarea class="text" name="notes" rows="4" [(ngModel)]="model.notes"></textarea>
        </label>
      </div>

      <div class="field">
        <span class="cap-label">Capabilities</span>
        <div class="chips">
          @for (cap of capabilities(); track cap.id) {
            <button
              type="button"
              class="chip"
              [class.active]="selectedCapabilities().includes(cap.key)"
              (click)="toggleCapability(cap.key)"
            >
              {{ cap.label }}
            </button>
          }
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn secondary" (click)="cancel()">Cancel</button>
        <button type="submit" class="btn" [disabled]="!model.name.trim() || saving()">
          Save
        </button>
      </div>
    </form>
  `,
  styles: `
    .page-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .page-head h1 {
      margin: 0 0 8px;
    }
    .scan-actions {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .scan-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .scan-banner.result {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
    .scan-head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .scan-head .btn {
      margin-left: auto;
    }
    .small {
      font-size: 0.85em;
      margin: 0;
    }
    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid var(--divider-color);
      border-top-color: var(--primary-color);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 16px;
    }
    .span2 {
      grid-column: span 2;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .cap-label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
    @media (max-width: 640px) {
      .grid {
        grid-template-columns: 1fr;
      }
      .span2 {
        grid-column: span 1;
      }
    }
  `,
})
export class DeviceFormPageComponent implements OnInit {
  private readonly devicesApi = inject(DevicesApi);
  private readonly areasApi = inject(AreasApi);
  private readonly capabilitiesApi = inject(CapabilitiesApi);
  private readonly attachmentsApi = inject(AttachmentsApi);
  private readonly labelScanApi = inject(LabelScanApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly localeStore = inject(LocaleStore);
  private readonly returnStore = inject(ReturnStore);
  /** Existing device's currency; null for new devices → Home Assistant's currency. */
  protected currency: string | null = null;

  /** Route param when editing; undefined when creating. */
  readonly deviceId = input<string | undefined>(undefined);
  /** Query param: preselect area when coming from an area page. */
  readonly areaId = input<string | undefined>(undefined);

  protected readonly areas = signal<AreaDto[]>([]);
  protected readonly capabilities = signal<CapabilityTypeDto[]>([]);
  protected readonly selectedCapabilities = signal<string[]>([]);
  protected readonly saving = signal(false);
  protected readonly categories = DEVICE_CATEGORIES;
  protected readonly statuses = DEVICE_STATUSES;

  protected readonly scanEnabled = signal(false);
  /** QR/barcode reading works without an AI provider. */
  protected readonly codesEnabled = signal(false);
  /** Codes found in the photo being scanned (for the progress banner). */
  protected readonly scanCodes = signal<string[]>([]);
  protected readonly scanModel = signal('');
  private scanMaxEdge = 1280;
  protected readonly scanning = signal(false);
  protected readonly scanResult = signal<LabelScanResultDto | null>(null);
  protected readonly scanChips = signal<string[]>([]);
  protected readonly scanConflicts = signal<string[]>([]);
  /** The label photo, attached to the device after it's saved. */
  private labelPhoto: File | null = null;

  protected readonly icons = { camera: mdiCameraOutline, upload: mdiUploadOutline, close: mdiClose };

  private originalCapabilities: string[] = [];

  protected model: CreateDeviceDto = {
    name: '',
    status: 'installed',
    category: null,
    areaId: null,
    manufacturer: null,
    brand: null,
    model: null,
    serialNumber: null,
    productUrl: null,
    purchasedFrom: null,
    notes: null,
  };
  protected purchaseDate = '';
  protected priceEuros: number | null = null;

  ngOnInit(): void {
    this.localeStore.ensureLoaded();
    this.labelScanApi.status().subscribe({
      next: (s) => {
        this.scanEnabled.set(s.enabled);
        this.codesEnabled.set(!!s.codes);
        this.scanModel.set(s.model ?? s.provider);
        this.scanMaxEdge = s.maxImageEdge || 1280;
      },
      error: () => this.scanEnabled.set(false),
    });
    this.areasApi.list().subscribe((areas) => this.areas.set(areas));
    this.capabilitiesApi.listTypes().subscribe((caps) => this.capabilities.set(caps));
    const id = this.deviceId();
    if (id) {
      this.devicesApi.get(id).subscribe((device) => this.populate(device));
    } else if (this.areaId()) {
      this.model.areaId = this.areaId();
    }
  }

  private populate(device: DeviceDetailDto): void {
    this.model = {
      name: device.name,
      status: device.status,
      category: device.category,
      areaId: device.areaId,
      manufacturer: device.manufacturer,
      brand: device.brand,
      model: device.model,
      serialNumber: device.serialNumber,
      productUrl: device.productUrl,
      purchasedFrom: device.purchasedFrom,
      notes: device.notes,
    };
    this.purchaseDate = device.purchaseDate?.slice(0, 10) ?? '';
    this.priceEuros =
      device.purchasePriceCents !== null ? device.purchasePriceCents / 100 : null;
    this.currency = device.purchaseCurrency;
    const keys = device.capabilities.map((c) => c.key);
    this.selectedCapabilities.set(keys);
    this.originalCapabilities = keys;
  }

  protected async onLabelPicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.scanning.set(true);
    this.scanResult.set(null);
    // Codes first, from the full-resolution photo (small QR codes need pixels).
    const codes = await readCodes(file).catch(() => [] as string[]);
    this.scanCodes.set(codes);
    if (!this.scanEnabled() && codes.length === 0) {
      this.scanning.set(false);
      this.toast.error('No QR code or barcode found — try a closer, sharper photo of the code');
      return;
    }
    // The model only needs enough pixels to read the text; a full-size phone
    // photo blows the context window and is slower to process. The original
    // is still what gets attached to the device.
    const forModel = this.scanEnabled() ? await downscaleImage(file, this.scanMaxEdge).catch(() => file) : null;
    this.labelScanApi.scan(forModel, codes).subscribe({
      next: (result) => {
        this.scanning.set(false);
        this.labelPhoto = file;
        this.applyScan(result);
      },
      error: () => this.scanning.set(false),
    });
  }

  /** Fill empty fields from the scan; never silently overwrite what the user
   *  already typed — report those as conflicts instead. */
  private applyScan(result: LabelScanResultDto): void {
    const f = result.fields;
    const chips: string[] = [];
    const conflicts: string[] = [];
    const take = (
      label: string,
      key: 'manufacturer' | 'brand' | 'model' | 'serialNumber',
      value: string | null
    ) => {
      if (!value) return;
      chips.push(`${label}: ${value}`);
      const current = this.model[key]?.trim();
      if (!current) this.model[key] = value;
      else if (current.toLowerCase() !== value.toLowerCase()) conflicts.push(label);
    };
    take('Manufacturer', 'manufacturer', f.manufacturer);
    take('Brand', 'brand', f.brand);
    take('Model', 'model', f.model);
    take('Serial', 'serialNumber', f.serialNumber);

    if (f.productType) chips.push(`Type: ${f.productType}`);
    for (const c of result.codes ?? []) {
      const reg = c.registry;
      chips.push(
        reg?.productName
          ? `Matter registry: ${[reg.vendorName, reg.productName].filter(Boolean).join(' ')}`
          : c.summary.length > 70
            ? c.summary.slice(0, 67) + '…'
            : c.summary
      );
    }
    if (!this.model.name.trim()) {
      const name = [f.brand ?? f.manufacturer, f.productType ?? f.model]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (name) this.model.name = name;
    }
    if (!this.model.category && result.categorySuggestion) {
      this.model.category = result.categorySuggestion as DeviceCategory;
      chips.push(`Category: ${result.categorySuggestion}`);
    }
    if (result.notesSuggestion) {
      const existing = this.model.notes?.trim();
      this.model.notes = existing
        ? `${existing}\n\n${result.notesSuggestion}`
        : result.notesSuggestion;
    }
    if (chips.length === 0) chips.push('Nothing legible found — try a sharper, closer photo');

    this.scanChips.set(chips);
    this.scanConflicts.set(conflicts);
    this.scanResult.set(result);
  }

  private async attachLabelPhoto(deviceId: string): Promise<void> {
    const file = this.labelPhoto;
    if (!file) return;
    await new Promise<void>((resolve) => {
      this.attachmentsApi.upload({ deviceId }, file, 'image', 'Rating label').subscribe({
        next: (event) => {
          if (event.type === HttpEventType.Response) resolve();
        },
        error: () => {
          this.toast.error('Device saved, but the label photo could not be attached');
          resolve();
        },
      });
    });
  }

  protected toggleCapability(key: string): void {
    this.selectedCapabilities.update((keys) =>
      keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]
    );
  }

  protected save(): void {
    if (!this.model.name.trim()) return;
    this.saving.set(true);
    const dto: CreateDeviceDto = {
      ...this.model,
      name: this.model.name.trim(),
      productUrl: this.model.productUrl?.trim() || null,
      purchaseDate: this.purchaseDate
        ? new Date(this.purchaseDate + 'T00:00:00Z').toISOString()
        : null,
      purchasePriceCents:
        this.priceEuros !== null && this.priceEuros !== undefined
          ? Math.round(this.priceEuros * 100)
          : null,
      // new devices: omitted, so the server applies Home Assistant's currency
      ...(this.currency ? { purchaseCurrency: this.currency } : {}),
    };
    const id = this.deviceId();
    const req = id ? this.devicesApi.update(id, dto) : this.devicesApi.create(dto);
    req.subscribe({
      next: async (device) => {
        await this.syncCapabilities(device.id);
        await this.attachLabelPhoto(device.id);
        this.saving.set(false);
        this.toast.success(id ? 'Device updated' : 'Device created');
        // Opened from a filtered list (Devices or Connections)? Go back to
        // exactly that list — filters, search and sort intact.
        if (!id) this.returnStore.adopt(NEW_DEVICE, device.id);
        const back = this.returnStore.for(device.id);
        if (back) {
          this.router.navigateByUrl(back.url, { replaceUrl: true });
          return;
        }
        // replaceUrl: the form itself isn't a page worth keeping in history —
        // otherwise "back" from the device would land back on the form
        // instead of wherever the user opened it from (e.g. an area page).
        this.router.navigate(['/devices', device.id], { replaceUrl: true });
      },
      error: () => this.saving.set(false),
    });
  }

  private async syncCapabilities(deviceId: string): Promise<void> {
    const wanted = this.selectedCapabilities();
    const added = wanted.filter((k) => !this.originalCapabilities.includes(k));
    const removed = this.originalCapabilities.filter((k) => !wanted.includes(k));
    await Promise.all([
      ...added.map((key) =>
        this.capabilitiesApi.setForDevice(deviceId, key).toPromise()
      ),
      ...removed.map((key) =>
        this.capabilitiesApi.removeForDevice(deviceId, key).toPromise()
      ),
    ]);
  }

  protected cancel(): void {
    const id = this.deviceId();
    if (!id) {
      const back = this.returnStore.for(NEW_DEVICE);
      if (back) {
        this.router.navigateByUrl(back.url, { replaceUrl: true });
        return;
      }
    }
    this.router.navigate(id ? ['/devices', id] : ['/devices'], { replaceUrl: true });
  }
}
