import { AiSettingsDto } from '@smart-home-inventory/shared';
import { AppConfig } from '../config/app-config';
import { HaRegistryClient } from '../ha/ha-registry.types';
import { AI_DEFAULTS, AiSettingsService, withDefaults } from './ai-settings.service';
import { SettingsService } from './settings.service';

function make(stored: unknown, cfg: Partial<AppConfig> = {}) {
  const store: { value: unknown } = { value: stored };
  const settings = {
    get: jest.fn(async () => store.value),
    set: jest.fn(async (_k: string, v: unknown) => {
      store.value = v;
    }),
  } as unknown as SettingsService;
  const svc = new AiSettingsService(settings, cfg as AppConfig, {} as HaRegistryClient);
  return { svc, store };
}

describe('AiSettingsService', () => {
  it('seeds Ollama from the legacy add-on options until settings are saved', async () => {
    const { svc } = make(null, { ollamaUrl: 'http://10.0.0.5:11434', ollamaModel: 'llava' } as Partial<AppConfig>);
    const s = await svc.get();
    expect(s.provider).toBe('ollama');
    expect(s.ollama.url).toBe('http://10.0.0.5:11434');
    expect(s.ollama.model).toBe('llava');
  });

  it('defaults to off with no legacy options', async () => {
    expect((await make(null).svc.get()).provider).toBe('none');
  });

  it('never returns the API key; null keeps it, empty clears it, a value replaces it', async () => {
    const { svc, store } = make(withDefaults({ provider: 'openai', openai: { ...AI_DEFAULTS.openai, apiKey: 'sk-old' } }));
    const view = await svc.view();
    expect(view.openai.apiKey).toBeNull();
    expect(view.openai.hasApiKey).toBe(true);

    const base: AiSettingsDto = withDefaults({ provider: 'openai' });
    await svc.save({ ...base, openai: { ...base.openai, apiKey: null } });
    expect((store.value as AiSettingsDto).openai.apiKey).toBe('sk-old');
    await svc.save({ ...base, openai: { ...base.openai, apiKey: 'sk-new' } });
    expect((store.value as AiSettingsDto).openai.apiKey).toBe('sk-new');
    await svc.save({ ...base, openai: { ...base.openai, apiKey: '' } });
    expect((store.value as AiSettingsDto).openai.apiKey).toBeNull();
  });

  it('has no provider when required fields are missing', async () => {
    const { svc } = make(null);
    expect(svc.provider(withDefaults({ provider: 'ollama' }))).toBeNull(); // no url
    expect(svc.provider(withDefaults({ provider: 'ha_ai_task' }))).toBeNull(); // no entity
  });

  it('fills missing nested fields from defaults (older stored values)', () => {
    const s = withDefaults({ provider: 'ollama', ollama: { url: 'http://x', model: 'm' } as AiSettingsDto['ollama'] });
    expect(s.ollama.numCtx).toBe(AI_DEFAULTS.ollama.numCtx);
    expect(s.scan.maxImageEdge).toBe(1280);
  });
});
