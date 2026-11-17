import { Logger } from '@nestjs/common';
import { AiSettingsDto, AiTestResultDto } from '@smart-home-inventory/shared';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

/**
 * "Look at this photo and answer with JSON" — the one thing Scan label needs
 * from an AI. Three ways to get it, picked in Settings → AI:
 *
 * - Ollama: local, private, free; the user runs the model.
 * - OpenAI-compatible: anything speaking /v1/chat/completions with images —
 *   OpenAI, OpenRouter, Google Gemini's OpenAI endpoint, LM Studio, LocalAI,
 *   vLLM. One code path covers most hosted and self-hosted options.
 * - Home Assistant AI Task: whichever AI integration the user already set up
 *   in HA (OpenAI, Google, Anthropic, Ollama…) via `ai_task.generate_data`.
 *   No keys in this add-on at all; HA owns the credentials.
 *
 * Each returns the model's raw text; the caller parses and normalises it, so
 * a chatty model that wraps JSON in prose still works.
 */

export interface VisionRequest {
  image: Buffer;
  mimeType: string;
  /** Task instructions (what to read and how). */
  prompt: string;
  /** JSON schema for providers that can enforce it (Ollama `format`). */
  jsonSchema: object;
  /** Plain-text description of the expected JSON, for providers that can't. */
  jsonShapeHint: string;
}

export interface VisionProvider {
  readonly id: AiSettingsDto['provider'];
  /** Model or entity name for status messages. */
  readonly label: string;
  /** host:port for status display, never a full URL with credentials. */
  readonly host: string | null;
  read(req: VisionRequest): Promise<string>;
  test(): Promise<AiTestResultDto>;
}

export class VisionError extends Error {}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ status: number; body: unknown; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error;
    throw new VisionError(
      e.name === 'TimeoutError' ? `timed out after ${Math.round(timeoutMs / 1000)}s` : e.message
    );
  }
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

// ---------------------------------------------------------------------------

export class OllamaVision implements VisionProvider {
  readonly id = 'ollama' as const;
  constructor(private readonly s: AiSettingsDto['ollama']) {}
  get label() {
    return this.s.model;
  }
  get host() {
    return hostOf(this.s.url);
  }
  private base() {
    return this.s.url.replace(/\/+$/, '');
  }

  async read(req: VisionRequest): Promise<string> {
    const r = await fetchJson(
      `${this.base()}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.s.model,
          stream: false,
          format: req.jsonSchema,
          // Ollama defaults to a 4096-token context; one photo + prompt
          // needs more. Asking per request avoids a server-side setting.
          options: { temperature: 0, num_ctx: this.s.numCtx },
          messages: [{ role: 'user', content: req.prompt, images: [req.image.toString('base64')] }],
        }),
      },
      this.s.timeoutSec * 1000
    );
    if (r.status !== 200) throw new VisionError(`Ollama answered ${r.status}: ${r.text.slice(0, 200)}`);
    return ((r.body as { message?: { content?: string } })?.message?.content ?? '').trim();
  }

  async test(): Promise<AiTestResultDto> {
    if (!this.s.url || !this.s.model) return { ok: false, message: 'Enter the Ollama URL and a model.' };
    try {
      const r = await fetchJson(`${this.base()}/api/tags`, { method: 'GET' }, 10_000);
      if (r.status !== 200) return { ok: false, message: `Ollama answered ${r.status}` };
      const models = ((r.body as { models?: Array<{ name: string }> })?.models ?? []).map((m) => m.name);
      const have = models.some((m) => m === this.s.model || m === `${this.s.model}:latest`);
      return have
        ? { ok: true, message: `Connected. ${this.s.model} is installed.`, models }
        : {
            ok: false,
            message: `Connected, but ${this.s.model} isn't pulled on that server. Run: ollama pull ${this.s.model}`,
            models,
          };
    } catch (err) {
      return { ok: false, message: `Can't reach Ollama at ${this.s.url}: ${(err as Error).message}` };
    }
  }
}

// ---------------------------------------------------------------------------

export class OpenAiCompatibleVision implements VisionProvider {
  readonly id = 'openai' as const;
  constructor(private readonly s: AiSettingsDto['openai']) {}
  get label() {
    return this.s.model;
  }
  get host() {
    return hostOf(this.s.baseUrl);
  }
  private base() {
    return this.s.baseUrl.replace(/\/+$/, '');
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.s.apiKey) h['Authorization'] = `Bearer ${this.s.apiKey}`;
    return h;
  }

  async read(req: VisionRequest): Promise<string> {
    const body = (jsonMode: boolean) =>
      JSON.stringify({
        model: this.s.model,
        temperature: 0,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${req.prompt}\n\n${req.jsonShapeHint}` },
              {
                type: 'image_url',
                image_url: { url: `data:${req.mimeType};base64,${req.image.toString('base64')}` },
              },
            ],
          },
        ],
      });
    const url = `${this.base()}/chat/completions`;
    const timeout = this.s.timeoutSec * 1000;
    let r = await fetchJson(url, { method: 'POST', headers: this.headers(), body: body(true) }, timeout);
    // Some servers (older LM Studio, some proxies) reject response_format.
    if (r.status === 400 && /response_format|json_object/i.test(r.text)) {
      r = await fetchJson(url, { method: 'POST', headers: this.headers(), body: body(false) }, timeout);
    }
    if (r.status === 401 || r.status === 403) throw new VisionError('API key was rejected');
    if (r.status !== 200) throw new VisionError(`API answered ${r.status}: ${r.text.slice(0, 200)}`);
    const choice = (r.body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: unknown }).text) : ''))
        .join('')
        .trim();
    }
    return '';
  }

  async test(): Promise<AiTestResultDto> {
    if (!this.s.baseUrl || !this.s.model) return { ok: false, message: 'Enter the API base URL and a model.' };
    try {
      const r = await fetchJson(`${this.base()}/models`, { method: 'GET', headers: this.headers() }, 15_000);
      if (r.status === 401 || r.status === 403) return { ok: false, message: 'Connected, but the API key was rejected.' };
      if (r.status !== 200) {
        return { ok: false, message: `API answered ${r.status}. Check the base URL (it usually ends in /v1).` };
      }
      const models = ((r.body as { data?: Array<{ id: string }> })?.data ?? []).map((m) => m.id);
      if (models.length === 0) return { ok: true, message: 'Connected (the server did not list its models).' };
      const have = models.some((m) => m === this.s.model || m.endsWith(`/${this.s.model}`));
      return have
        ? { ok: true, message: `Connected. ${this.s.model} is available.`, models }
        : { ok: false, message: `Connected, but no model named ${this.s.model} is listed.`, models };
    } catch (err) {
      return { ok: false, message: `Can't reach ${this.s.baseUrl}: ${(err as Error).message}` };
    }
  }
}

// ---------------------------------------------------------------------------

export interface HaRestTarget {
  /** e.g. http://supervisor/core/api or https://ha.local:8123/api */
  apiBase: string;
  token: string;
}

/** Folder inside HA's /media that this add-on may write to (map: media:rw). */
export const MEDIA_ROOT = '/media';
export const MEDIA_SUBDIR = 'smart_home_inventory';

export class HaAiTaskVision implements VisionProvider {
  readonly id = 'ha_ai_task' as const;
  private readonly logger = new Logger(HaAiTaskVision.name);
  constructor(
    private readonly s: AiSettingsDto['haAiTask'],
    private readonly ha: HaRestTarget | null,
    private readonly mediaRoot = MEDIA_ROOT
  ) {}
  get label() {
    return this.s.entityId;
  }
  get host() {
    return 'Home Assistant';
  }

  async read(req: VisionRequest): Promise<string> {
    if (!this.ha) throw new VisionError('Home Assistant API is not available in this mode');
    // ai_task attachments are media-source items, so the photo goes into
    // HA's media folder for the duration of the call.
    const ext = req.mimeType === 'image/png' ? 'png' : req.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const name = `label-${randomUUID()}.${ext}`;
    const dir = path.join(this.mediaRoot, MEDIA_SUBDIR);
    const file = path.join(dir, name);
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(file, req.image);
    } catch (err) {
      throw new VisionError(
        `Can't write to Home Assistant's media folder (${(err as Error).message}). Update the add-on so it has media access.`
      );
    }
    try {
      const r = await fetchJson(
        `${this.ha.apiBase}/services/ai_task/generate_data?return_response`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ha.token}` },
          body: JSON.stringify({
            entity_id: this.s.entityId,
            task_name: 'Read equipment rating label',
            instructions: `${req.prompt}\n\n${req.jsonShapeHint}`,
            attachments: [
              {
                media_content_id: `media-source://media_source/local/${MEDIA_SUBDIR}/${name}`,
                media_content_type: req.mimeType,
              },
            ],
          }),
        },
        this.s.timeoutSec * 1000
      );
      if (r.status !== 200) {
        throw new VisionError(`Home Assistant answered ${r.status}: ${r.text.slice(0, 300)}`);
      }
      const data = (r.body as { service_response?: { data?: unknown } })?.service_response?.data;
      if (typeof data === 'string') return data.trim();
      return data ? JSON.stringify(data) : '';
    } finally {
      await fsp.unlink(file).catch((e: Error) => this.logger.warn(`Couldn't remove ${file}: ${e.message}`));
    }
  }

  async test(): Promise<AiTestResultDto> {
    if (!this.ha) return { ok: false, message: 'Home Assistant API is not available in this mode.' };
    if (!this.s.entityId) return { ok: false, message: 'Choose an AI Task entity.' };
    try {
      const r = await fetchJson(
        `${this.ha.apiBase}/states/${encodeURIComponent(this.s.entityId)}`,
        { method: 'GET', headers: { Authorization: `Bearer ${this.ha.token}` } },
        10_000
      );
      if (r.status === 404) return { ok: false, message: `${this.s.entityId} doesn't exist in Home Assistant.` };
      if (r.status !== 200) return { ok: false, message: `Home Assistant answered ${r.status}` };
      const state = (r.body as { state?: string })?.state;
      if (state === 'unavailable') return { ok: false, message: `${this.s.entityId} is unavailable in Home Assistant.` };
    } catch (err) {
      return { ok: false, message: `Can't reach Home Assistant: ${(err as Error).message}` };
    }
    try {
      await fsp.mkdir(path.join(this.mediaRoot, MEDIA_SUBDIR), { recursive: true });
      await fsp.access(path.join(this.mediaRoot, MEDIA_SUBDIR), fsp.constants.W_OK);
    } catch {
      return {
        ok: false,
        message: "Entity found, but the add-on can't write to Home Assistant's media folder. Update/restart the add-on.",
      };
    }
    return { ok: true, message: `Ready. Labels will be read by ${this.s.entityId}.` };
  }
}
