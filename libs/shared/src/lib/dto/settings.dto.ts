import { z } from 'zod';

/**
 * Settings edited in the app (Settings page), stored in the add-on's
 * database. Add-on options in Home Assistant only seed the first values.
 */

// ---------------------------------------------------------------------------
// AI (used by Scan label)
// ---------------------------------------------------------------------------

export const AI_PROVIDERS = ['none', 'ollama', 'openai', 'ha_ai_task'] as const;
export const AiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  none: 'Off',
  ollama: 'Ollama (local)',
  openai: 'OpenAI-compatible API',
  ha_ai_task: 'Home Assistant AI Task',
};

const timeoutSec = z.number().int().min(10).max(900);

export const AiSettingsSchema = z.object({
  provider: AiProviderSchema,
  ollama: z.object({
    /** e.g. http://192.168.1.50:11434 */
    url: z.string().max(500),
    /** A vision model pulled on that server, e.g. qwen3-vl:4b-instruct, llava, minicpm-v. */
    model: z.string().max(200),
    /** Context window per request; one photo + prompt needs ~4.5k tokens. */
    numCtx: z.number().int().min(2048).max(131072),
    timeoutSec,
  }),
  openai: z.object({
    /** OpenAI: https://api.openai.com/v1 · OpenRouter: https://openrouter.ai/api/v1 ·
     *  Gemini: https://generativelanguage.googleapis.com/v1beta/openai ·
     *  LM Studio: http://host:1234/v1 */
    baseUrl: z.string().max(500),
    model: z.string().max(200),
    /** Write-only from the UI: GET returns it masked; PUT with null keeps the stored one. */
    apiKey: z.string().max(500).nullable(),
    timeoutSec,
  }),
  haAiTask: z.object({
    /** An ai_task.* entity from any AI integration set up in Home Assistant. */
    entityId: z.string().max(200),
    timeoutSec,
  }),
  scan: z.object({
    /** Photos are shrunk to this longest edge before being sent (the original is still attached). */
    maxImageEdge: z.number().int().min(512).max(4096),
  }),
});
export type AiSettingsDto = z.infer<typeof AiSettingsSchema>;

/** What GET returns: the stored API key is never sent back, only whether one is set. */
export type AiSettingsViewDto = Omit<AiSettingsDto, 'openai'> & {
  openai: Omit<AiSettingsDto['openai'], 'apiKey'> & { apiKey: null; hasApiKey: boolean };
};

export interface AiTestResultDto {
  ok: boolean;
  message: string;
  /** Models the server offers, when it can list them (Ollama / OpenAI). */
  models?: string[];
}

export interface HaAiTaskEntityDto {
  entityId: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Region (overrides for what is otherwise derived from HA's country)
// ---------------------------------------------------------------------------

export const WIRING_STANDARDS = ['auto', 'iec', 'nec'] as const;
export const WiringStandardSchema = z.enum(WIRING_STANDARDS);
export type WiringStandard = z.infer<typeof WiringStandardSchema>;

export const REGION_LINK_SETS = ['auto', 'us', 'generic'] as const;
export type RegionLinkSet = (typeof REGION_LINK_SETS)[number];

export const RegionSettingsSchema = z.object({
  /** Diagram wire colours: IEC (brown/black/grey/blue/green-yellow) or NEC
   *  (black/red/blue/white/green). auto = from HA's country. */
  wiringStandard: WiringStandardSchema,
  /** Parts/recall links: US retailers + CPSC, or generic web searches. */
  resourceLinks: z.enum(REGION_LINK_SETS),
});
export type RegionSettingsDto = z.infer<typeof RegionSettingsSchema>;

/** Region settings with "auto" resolved against HA's country. */
export interface EffectiveRegionDto extends RegionSettingsDto {
  country: string | null;
  effectiveWiring: 'iec' | 'nec';
  effectiveLinks: 'us' | 'generic';
}

/** Countries that wire to NEC-style colours and 120/240 V split phase. */
export const NORTH_AMERICA = ['US', 'CA', 'MX', 'PR'] as const;
export function isNorthAmerica(country: string | null | undefined): boolean {
  return !!country && (NORTH_AMERICA as readonly string[]).includes(country.toUpperCase());
}
