import { computed, inject, Injectable, signal } from '@angular/core';
import { HaLocaleDto } from '@smart-home-inventory/shared';
import { HaApi } from '../api/api.services';

/**
 * Home Assistant's general settings (currency, country, units) as the app's
 * defaults. Loaded once; falls back to the server's fallback when HA can't be
 * reached.
 */
@Injectable({ providedIn: 'root' })
export class LocaleStore {
  private readonly api = inject(HaApi);
  readonly locale = signal<HaLocaleDto | null>(null);
  readonly currency = computed(() => this.locale()?.currency ?? 'EUR');
  private requested = false;

  ensureLoaded(): void {
    if (this.requested) return;
    this.requested = true;
    this.api.locale().subscribe({
      next: (l) => this.locale.set(l),
      error: () => (this.requested = false),
    });
  }

  /** "$", "€", "£" … for a currency code (narrow symbol, browser locale). */
  symbol(code: string | null | undefined): string {
    const c = (code || this.currency()).toUpperCase();
    try {
      const part = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: c,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((p) => p.type === 'currency');
      return part?.value ?? c;
    } catch {
      return c;
    }
  }

  /** 1234.5 + "USD" → "$1,234.50" in the browser's locale. */
  money(cents: number, code: string | null | undefined): string {
    const c = (code || this.currency()).toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${c}`;
    }
  }
}
