import { Inject, Injectable } from '@nestjs/common';
import {
  AiSettingsDto,
  AiSettingsSchema,
  AiSettingsViewDto,
  HaAiTaskEntityDto,
} from '@smart-home-inventory/shared';
import { AppConfig } from '../config/app-config';
import { HA_REGISTRY_CLIENT, HaRegistryClient } from '../ha/ha-registry.types';
import {
  HaAiTaskVision,
  HaRestTarget,
  OllamaVision,
  OpenAiCompatibleVision,
  VisionProvider,
} from '../label-scan/vision-providers';
import { SettingsService } from './settings.service';

const KEY = 'ai';

export const AI_DEFAULTS: AiSettingsDto = {
  provider: 'none',
  ollama: { url: '', model: 'qwen3-vl:4b-instruct', numCtx: 8192, timeoutSec: 300 },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: null, timeoutSec: 120 },
  haAiTask: { entityId: '', timeoutSec: 180 },
  scan: { maxImageEdge: 1280 },
};

/** Fill gaps from defaults so older stored values gain new fields. */
export function withDefaults(stored: Partial<AiSettingsDto> | null): AiSettingsDto {
  return {
    provider: stored?.provider ?? AI_DEFAULTS.provider,
    ollama: { ...AI_DEFAULTS.ollama, ...(stored?.ollama ?? {}) },
    openai: { ...AI_DEFAULTS.openai, ...(stored?.openai ?? {}) },
    haAiTask: { ...AI_DEFAULTS.haAiTask, ...(stored?.haAiTask ?? {}) },
    scan: { ...AI_DEFAULTS.scan, ...(stored?.scan ?? {}) },
  };
}

/**
 * AI settings for Scan label. Stored in the app's database and edited in
 * Settings → AI. Until the user saves anything, the legacy add-on options
 * (`ollama_url`, `ollama_model`) seed an Ollama configuration, so existing
 * installs keep working unchanged.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
    @Inject(HA_REGISTRY_CLIENT) private readonly client: HaRegistryClient
  ) {}

  async get(): Promise<AiSettingsDto> {
    const stored = await this.settings.get<Partial<AiSettingsDto>>(KEY);
    if (stored) return withDefaults(stored);
    // first run: inherit the add-on options, if any
    const s = withDefaults(null);
    if (this.config.ollamaUrl && this.config.ollamaModel) {
      s.provider = 'ollama';
      s.ollama.url = this.config.ollamaUrl;
      s.ollama.model = this.config.ollamaModel;
    }
    return s;
  }

  /** Safe for the UI: the API key is replaced by a flag. */
  async view(): Promise<AiSettingsViewDto> {
    const s = await this.get();
    return {
      ...s,
      openai: { ...s.openai, apiKey: null, hasApiKey: !!s.openai.apiKey },
    };
  }

  /**
   * Save. `openai.apiKey`: null keeps the stored key, "" clears it, any other
   * string replaces it — so the UI never has to hold the real key.
   */
  async save(input: AiSettingsDto): Promise<AiSettingsViewDto> {
    const current = await this.get();
    const next = AiSettingsSchema.parse({
      ...input,
      ollama: { ...input.ollama, url: input.ollama.url.trim().replace(/\/+$/, '') },
      openai: {
        ...input.openai,
        baseUrl: input.openai.baseUrl.trim().replace(/\/+$/, ''),
        apiKey:
          input.openai.apiKey === null
            ? current.openai.apiKey
            : input.openai.apiKey.trim() || null,
      },
      haAiTask: { ...input.haAiTask, entityId: input.haAiTask.entityId.trim() },
    });
    await this.settings.set(KEY, next);
    return this.view();
  }

  haRestTarget(): HaRestTarget | null {
    if (this.config.supervisorToken) {
      return { apiBase: 'http://supervisor/core/api', token: this.config.supervisorToken };
    }
    if (this.config.haUrl && this.config.haToken) {
      return { apiBase: `${this.config.haUrl.replace(/\/+$/, '')}/api`, token: this.config.haToken };
    }
    return null;
  }

  /** The configured provider, or null when AI is off / incomplete. */
  provider(s: AiSettingsDto): VisionProvider | null {
    switch (s.provider) {
      case 'ollama':
        return s.ollama.url && s.ollama.model ? new OllamaVision(s.ollama) : null;
      case 'openai':
        return s.openai.baseUrl && s.openai.model ? new OpenAiCompatibleVision(s.openai) : null;
      case 'ha_ai_task':
        return s.haAiTask.entityId ? new HaAiTaskVision(s.haAiTask, this.haRestTarget()) : null;
      default:
        return null;
    }
  }

  async aiTaskEntities(): Promise<HaAiTaskEntityDto[]> {
    if (!this.client.listStatesByDomain) return [];
    const states = await this.client.listStatesByDomain('ai_task').catch(() => []);
    return states
      .map((s) => ({ entityId: s.entity_id, name: s.name || s.entity_id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
