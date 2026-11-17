import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RegionSettingsDto } from '@smart-home-inventory/shared';
import { RegionStore } from '../../core/region/region.store';
import { ToastService } from '../../core/toast/toast.service';

/** Settings card: regional conventions that default from HA's country. */
@Component({
  selector: 'app-region-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card section">
      <h3>Region</h3>
      @if (store.region(); as r) {
        <p class="muted">
          Defaults follow Home Assistant's country
          (<b>{{ r.country ?? 'not set' }}</b>). Override them here if they
          don't suit your home.
        </p>
        <div class="grid">
          <label>
            Wire colours on diagrams
            <select class="text" [value]="r.wiringStandard" (change)="save({ wiringStandard: $any($event.target).value })">
              <option value="auto">Automatic ({{ r.effectiveWiring === 'nec' ? 'North American' : 'IEC / European' }})</option>
              <option value="nec">North American — black/red hot, white neutral, green ground</option>
              <option value="iec">IEC / European — brown/black/grey live, blue neutral, green-yellow earth</option>
            </select>
          </label>
          <label>
            Parts &amp; recall links
            <select class="text" [value]="r.resourceLinks" (change)="save({ resourceLinks: $any($event.target).value })">
              <option value="auto">Automatic ({{ r.effectiveLinks === 'us' ? 'US retailers' : 'web search' }})</option>
              <option value="us">US — RepairClinic, PartSelect… + CPSC recalls</option>
              <option value="generic">Anywhere — web searches for parts</option>
            </select>
          </label>
        </div>
        <p class="hint">Wire colours apply to new wires; existing wires keep the colour they were given.</p>
      }
    </div>
  `,
  styles: `
    .section { margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; }
    .hint { margin: 8px 0 0; color: var(--secondary-text-color); font-size: 0.85em; }
  `,
})
export class RegionSettingsComponent implements OnInit {
  protected readonly store = inject(RegionStore);
  private readonly toast = inject(ToastService);

  ngOnInit(): void {
    this.store.ensureLoaded();
  }

  protected save(change: Partial<RegionSettingsDto>): void {
    const r = this.store.region();
    if (!r) return;
    this.store
      .save({ wiringStandard: r.wiringStandard, resourceLinks: r.resourceLinks, ...change })
      .subscribe(() => this.toast.success('Region saved'));
  }
}
