import { Inject, Injectable, Logger } from '@nestjs/common';
import { HaLocaleDto } from '@smart-home-inventory/shared';
import { HA_REGISTRY_CLIENT, HaRegistryClient } from './ha-registry.types';

/** Used when HA can't be reached or has no currency set — upstream's default. */
export const FALLBACK_CURRENCY = 'EUR';
const TTL_MS = 10 * 60 * 1000;

/**
 * Home Assistant's general settings (currency, country, units, time zone,
 * language) as the app's defaults. Cached for a few minutes; refreshed on
 * every sync so a change in HA shows up without a restart.
 */
@Injectable()
export class HaLocaleService {
  private readonly logger = new Logger(HaLocaleService.name);
  private cached: { at: number; value: HaLocaleDto } | null = null;

  constructor(@Inject(HA_REGISTRY_CLIENT) private readonly client: HaRegistryClient) {}

  async get(force = false): Promise<HaLocaleDto> {
    if (!force && this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;
    let value: HaLocaleDto = {
      currency: FALLBACK_CURRENCY,
      country: null,
      language: null,
      timeZone: null,
      unitSystem: null,
      fromHa: false,
    };
    if (this.client.getCoreConfig) {
      try {
        const c = await this.client.getCoreConfig();
        value = {
          currency: (c.currency ?? FALLBACK_CURRENCY).toUpperCase(),
          country: c.country ? c.country.toUpperCase() : null,
          language: c.language,
          timeZone: c.time_zone,
          unitSystem:
            c.unit_system === 'us_customary' || c.unit_system === 'metric' ? c.unit_system : null,
          fromHa: true,
        };
      } catch (err) {
        this.logger.warn(`Could not read HA core config; using fallbacks: ${(err as Error).message}`);
        if (this.cached) return this.cached.value; // keep the last good answer
      }
    }
    this.cached = { at: Date.now(), value };
    return value;
  }

  async currency(): Promise<string> {
    return (await this.get()).currency;
  }
}
