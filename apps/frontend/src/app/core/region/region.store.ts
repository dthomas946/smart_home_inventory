import { computed, inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { EffectiveRegionDto, RegionSettingsDto, setWiringStandard } from '@smart-home-inventory/shared';
import { SettingsApi } from '../api/api.services';

/**
 * Regional conventions (wire colours, parts/recall links). Defaults follow
 * Home Assistant's country; Settings can override. Loaded once at start-up so
 * wire colours are right before any diagram draws.
 */
@Injectable({ providedIn: 'root' })
export class RegionStore {
  private readonly api = inject(SettingsApi);
  readonly region = signal<EffectiveRegionDto | null>(null);
  /** Parts/recall link set for buildResourceLinks. */
  readonly links = computed(() => this.region()?.effectiveLinks ?? 'us');
  private requested = false;

  ensureLoaded(): void {
    if (this.requested) return;
    this.requested = true;
    this.api.region().subscribe({
      next: (r) => this.apply(r),
      error: () => (this.requested = false),
    });
  }

  save(dto: RegionSettingsDto): Observable<EffectiveRegionDto> {
    return this.api.saveRegion(dto).pipe(tap((r) => this.apply(r)));
  }

  private apply(r: EffectiveRegionDto): void {
    setWiringStandard(r.effectiveWiring);
    this.region.set(r);
  }
}
