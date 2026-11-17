import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseModelJson } from './label-scan.service';
import { HaAiTaskVision, MEDIA_SUBDIR, OllamaVision, OpenAiCompatibleVision } from './vision-providers';

const req = {
  image: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  mimeType: 'image/jpeg',
  prompt: 'read it',
  jsonSchema: { type: 'object' },
  jsonShapeHint: 'JSON please',
};

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = handler(String(url), init ?? {});
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return calls;
}

describe('OllamaVision', () => {
  it('sends the image, schema and num_ctx, and returns message content', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { message: { content: '{"model":"X"}' } } }));
    const v = new OllamaVision({ url: 'http://h:11434/', model: 'm', numCtx: 8192, timeoutSec: 30 });
    expect(await v.read(req)).toBe('{"model":"X"}');
    expect(calls[0].url).toBe('http://h:11434/api/chat');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.options.num_ctx).toBe(8192);
    expect(body.format).toEqual({ type: 'object' });
    expect(body.messages[0].images[0]).toBe(req.image.toString('base64'));
  });

  it('test() reports a model that is not pulled', async () => {
    mockFetch(() => ({ status: 200, body: { models: [{ name: 'llava:latest' }] } }));
    const r = await new OllamaVision({ url: 'http://h', model: 'qwen3-vl', numCtx: 8192, timeoutSec: 30 }).test();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ollama pull qwen3-vl/);
  });
});

describe('OpenAiCompatibleVision', () => {
  const s = { baseUrl: 'https://api.example/v1', model: 'gpt-x', apiKey: 'sk-1', timeoutSec: 30 };

  it('posts an image_url data URI with the key, in JSON mode', async () => {
    const calls = mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: '{"a":1}' } }] } }));
    expect(await new OpenAiCompatibleVision(s).read(req)).toBe('{"a":1}');
    expect(calls[0].url).toBe('https://api.example/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-1');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('retries without response_format when the server rejects it', async () => {
    let n = 0;
    const calls = mockFetch(() =>
      ++n === 1
        ? { status: 400, body: { error: 'response_format not supported' } }
        : { status: 200, body: { choices: [{ message: { content: 'ok' } }] } }
    );
    expect(await new OpenAiCompatibleVision(s).read(req)).toBe('ok');
    expect(JSON.parse(calls[1].init.body as string).response_format).toBeUndefined();
  });

  it('turns 401 into a clear key error', async () => {
    mockFetch(() => ({ status: 401, body: {} }));
    await expect(new OpenAiCompatibleVision(s).read(req)).rejects.toThrow(/API key was rejected/);
  });
});

describe('HaAiTaskVision', () => {
  it('stages the photo in media, calls ai_task.generate_data, returns data, and cleans up', async () => {
    const media = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
    let seenFile = '';
    const calls = mockFetch((url, init) => {
      const body = JSON.parse(init.body as string);
      const id: string = body.attachments[0].media_content_id;
      seenFile = path.join(media, MEDIA_SUBDIR, id.split('/').pop() as string);
      expect(fs.existsSync(seenFile)).toBe(true); // present during the call
      return { status: 200, body: { service_response: { data: '{"model":"Y"}' } } };
    });
    const v = new HaAiTaskVision(
      { entityId: 'ai_task.openai', timeoutSec: 30 },
      { apiBase: 'http://supervisor/core/api', token: 't' },
      media
    );
    expect(await v.read(req)).toBe('{"model":"Y"}');
    expect(calls[0].url).toBe('http://supervisor/core/api/services/ai_task/generate_data?return_response');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.entity_id).toBe('ai_task.openai');
    expect(body.attachments[0].media_content_id).toMatch(
      new RegExp(`^media-source://media_source/local/${MEDIA_SUBDIR}/label-.+\\.jpg$`)
    );
    expect(fs.existsSync(seenFile)).toBe(false); // removed afterwards
  });
});

describe('parseModelJson', () => {
  it('accepts bare JSON and JSON wrapped in prose or fences', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('Sure!\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('rejects replies with no JSON', () => {
    expect(() => parseModelJson('no idea')).toThrow(/did not return JSON/);
  });
});
