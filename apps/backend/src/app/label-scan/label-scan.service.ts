import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DEVICE_CATEGORIES,
  DeviceCategory,
  LabelScanFields,
  LabelScanResultDto,
  LabelScanStatusDto,
} from '@smart-home-inventory/shared';
import { AppConfig } from '../config/app-config';

/** Small vision models on a 4 GB GPU take a minute or two per image. */
const OLLAMA_TIMEOUT_MS = 300_000;
/** Ollama defaults to a 4096-token context; one photo plus the prompt and
 *  schema already exceeds that. Request more per call rather than requiring
 *  OLLAMA_CONTEXT_LENGTH on the server. */
const OLLAMA_NUM_CTX = 8192;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** JSON schema handed to Ollama's `format` so the model can't free-wheel. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    manufacturer: { type: ['string', 'null'] },
    brand: { type: ['string', 'null'] },
    model: { type: ['string', 'null'] },
    serialNumber: { type: ['string', 'null'] },
    productType: { type: ['string', 'null'] },
    manufactureDate: { type: ['string', 'null'] },
    electrical: {
      type: 'object',
      properties: {
        voltage: { type: ['string', 'null'] },
        amps: { type: ['string', 'null'] },
        watts: { type: ['string', 'null'] },
        hz: { type: ['string', 'null'] },
        phase: { type: ['string', 'null'] },
      },
      required: ['voltage', 'amps', 'watts', 'hz', 'phase'],
    },
    extra: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value'],
      },
    },
  },
  required: [
    'manufacturer',
    'brand',
    'model',
    'serialNumber',
    'productType',
    'manufactureDate',
    'electrical',
    'extra',
  ],
} as const;

const PROMPT = `You are reading the rating plate / nameplate / specification label on a piece of household equipment (appliance, HVAC unit, water heater, electrical device, etc.).

Extract exactly what is printed. Rules:
- manufacturer: the company named as maker on the plate ("Manufactured by", "Mfd. by", a corporate name like "Electrolux Home Products" or "Whirlpool Corporation"). If only a brand logo is present, put the brand here too.
- brand: the consumer brand / logo on the plate when it differs from the manufacturer line (e.g. brand "Frigidaire" with manufacturer "Electrolux Home Products"; brand "Bryant" with manufacturer "Carrier Corporation"). null when they are the same or no separate brand is shown.
- model: the model number / product number (labels say "Model", "Model No.", "M/N", "Cat. No.", "Product No."). Copy it character for character including dashes; do not confuse it with the serial number.
- serialNumber: the serial number ("Serial", "S/N", "SN"). Copy exactly.
- productType: the kind of equipment as printed (e.g. "Split System Heat Pump", "Gas Water Heater", "Refrigerator"), or null.
- manufactureDate: the manufacture date or date code as printed, or null.
- electrical: voltage (e.g. "208/230V"), amps (RLA/FLA/MCA/MOP → pick the most prominent, or combine like "RLA 12.3 / LRA 64"), watts, hz, phase — each as printed or null.
- extra: any other labeled specs as key/value pairs, e.g. refrigerant type and charge, BTU/h, tonnage, gallons, input rating, gas type, IP rating, agency listing numbers. Omit marketing text.
Use null when a field is not visible. Never invent values.`;

const CATEGORY_HINTS: Array<[RegExp, DeviceCategory]> = [
  [/thermostat/i, 'thermostat'],
  [/water heater|boiler/i, 'water_heater'],
  [/heat pump|air conditioner|condens|furnace|air handler|hvac|mini.?split|evaporator/i, 'air_handling_unit'],
  [/\bfan\b|blower/i, 'fan'],
  [/pump/i, 'pump'],
  [/valve/i, 'valve'],
  [/radiator/i, 'radiator'],
  [/meter/i, 'meter'],
  [/camera/i, 'camera'],
  [/router|switch\b.*(ethernet|network)|access point|modem|gateway/i, 'network'],
  [/breaker|load center|panel/i, 'breaker'],
  [/refrigerator|freezer|washer|dryer|dishwasher|range|oven|microwave|cooktop|disposal|appliance/i, 'appliance'],
  [/\blight|lamp|luminaire|fixture/i, 'light'],
  [/sensor|detector/i, 'sensor'],
];

function clean(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.toLowerCase() !== 'null' && t.toLowerCase() !== 'n/a' ? t : null;
}

export function guessCategory(productType: string | null): DeviceCategory | null {
  if (!productType) return null;
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(productType)) return cat;
  return null;
}

/** Normalise the model's JSON into LabelScanFields — defensive about shape. */
export function normalizeFields(raw: unknown): LabelScanFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const el = (r['electrical'] && typeof r['electrical'] === 'object'
    ? r['electrical']
    : {}) as Record<string, unknown>;
  const extra: Record<string, string> = {};
  const rawExtra = r['extra'];
  if (Array.isArray(rawExtra)) {
    for (const item of rawExtra) {
      const k = clean((item as Record<string, unknown>)?.['key']);
      const v = clean((item as Record<string, unknown>)?.['value']);
      if (k && v) extra[k] = v;
    }
  } else if (rawExtra && typeof rawExtra === 'object') {
    for (const [k, v] of Object.entries(rawExtra as Record<string, unknown>)) {
      const cv = clean(v);
      if (cv) extra[k] = cv;
    }
  }
  return {
    manufacturer: clean(r['manufacturer']),
    brand: clean(r['brand']),
    model: clean(r['model']),
    serialNumber: clean(r['serialNumber']),
    productType: clean(r['productType']),
    manufactureDate: clean(r['manufactureDate']),
    electrical: {
      voltage: clean(el['voltage']),
      amps: clean(el['amps']),
      watts: clean(el['watts']),
      hz: clean(el['hz']),
      phase: clean(el['phase']),
    },
    extra,
  };
}

export function buildNotes(f: LabelScanFields): string {
  const lines: string[] = [];
  const e = f.electrical;
  const elec = [
    e.voltage && `${e.voltage}`,
    e.amps && `${e.amps} A`,
    e.watts && `${e.watts} W`,
    e.hz && `${e.hz} Hz`,
    e.phase && `${e.phase} phase`,
  ].filter(Boolean);
  if (elec.length) lines.push(`Electrical: ${elec.join(', ')}`);
  if (f.manufactureDate) lines.push(`Manufactured: ${f.manufactureDate}`);
  for (const [k, v] of Object.entries(f.extra)) lines.push(`${k}: ${v}`);
  return lines.length ? `From rating label:\n${lines.join('\n')}` : '';
}

@Injectable()
export class LabelScanService {
  private readonly logger = new Logger(LabelScanService.name);

  constructor(private readonly config: AppConfig) {}

  status(): LabelScanStatusDto {
    if (!this.config.labelScanEnabled) return { enabled: false, host: null, model: null };
    let host: string | null = null;
    try {
      host = new URL(this.config.ollamaUrl as string).host;
    } catch {
      host = null;
    }
    return { enabled: true, host, model: this.config.ollamaModel ?? null };
  }

  async scan(image: Buffer, mimeType: string): Promise<LabelScanResultDto> {
    if (!this.config.labelScanEnabled) {
      throw new ServiceUnavailableException(
        'Label scanning is not configured — set ollama_url and ollama_model in the add-on options.'
      );
    }
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
      throw new BadRequestException(`Unsupported image type ${mimeType}; use JPEG, PNG or WebP`);
    }
    if (image.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Image is too large (${image.length} bytes)`);
    }

    const started = Date.now();
    const model = this.config.ollamaModel as string;
    let res: Response;
    try {
      res = await fetch(`${this.config.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: RESPONSE_SCHEMA,
          options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX },
          messages: [{ role: 'user', content: PROMPT, images: [image.toString('base64')] }],
        }),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
      throw new BadGatewayException(`Ollama request ${msg}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException(`Ollama answered ${res.status}: ${text.slice(0, 200)}`);
    }

    const body = (await res.json()) as { message?: { content?: string } };
    const content = body.message?.content ?? '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Some models wrap JSON in prose or code fences despite `format`.
      const m = /\{[\s\S]*\}/.exec(content);
      if (!m) throw new BadGatewayException('Model did not return JSON');
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        throw new BadGatewayException('Model returned malformed JSON');
      }
    }

    const fields = normalizeFields(parsed);
    const durationMs = Date.now() - started;
    this.logger.log(
      `Label scan via ${model} in ${durationMs} ms: ` +
        `${fields.brand ?? fields.manufacturer ?? '?'} / ${fields.model ?? '?'}`
    );
    const categorySuggestion = guessCategory(fields.productType);
    return {
      fields,
      notesSuggestion: buildNotes(fields),
      categorySuggestion:
        categorySuggestion && (DEVICE_CATEGORIES as readonly string[]).includes(categorySuggestion)
          ? categorySuggestion
          : null,
      model,
      durationMs,
    };
  }
}
