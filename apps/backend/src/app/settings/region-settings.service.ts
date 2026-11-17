import { Injectable } from '@nestjs/common';
import {
  EffectiveRegionDto,
  isNorthAmerica,
  RegionSettingsDto,
} from '@smart-home-inventory/shared';
import { HaLocaleService } from '../ha/ha-locale.service';
import { SettingsService } from './settings.service';

const KEY = 'region';
const DEFAULTS: RegionSettingsDto = { wiringStandard: 'auto', resourceLinks: 'auto' };

/**
 * Regional conventions that differ between installs — wire colours and which
 * parts/recall sites make sense — default from Home Assistant's country and
 * can be overridden in Settings.
 */
@Injectable()
export class RegionSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly locale: HaLocaleService
  ) {}

  async get(): Promise<RegionSettingsDto> {
    return { ...DEFAULTS, ...((await this.settings.get<Partial<RegionSettingsDto>>(KEY)) ?? {}) };
  }

  async effective(): Promise<EffectiveRegionDto> {
    const [s, loc] = await Promise.all([this.get(), this.locale.get()]);
    const na = isNorthAmerica(loc.country);
    const us = loc.country === 'US' || loc.country === 'CA' || loc.country === 'PR';
    return {
      ...s,
      country: loc.country,
      effectiveWiring: s.wiringStandard === 'auto' ? (na ? 'nec' : 'iec') : s.wiringStandard,
      effectiveLinks: s.resourceLinks === 'auto' ? (us ? 'us' : 'generic') : s.resourceLinks,
    };
  }

  async save(dto: RegionSettingsDto): Promise<EffectiveRegionDto> {
    await this.settings.set(KEY, dto);
    return this.effective();
  }
}
