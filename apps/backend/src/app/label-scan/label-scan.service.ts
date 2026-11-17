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
import { AiSettingsService } from '../settings/ai-settings.service';
import { VisionError } from './vision-providers';

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

/** Plain-text JSON contract for providers that can't take a JSON schema. */
export const JSON_SHAPE_HINT = `Respond with ONLY a JSON object (no prose, no code fences) with exactly these keys:
{"manufacturer": string|null, "brand": string|null, "model": string|null, "serialNumber": string|null,
 "productType": string|null, "manufactureDate": string|null,
 "electrical": {"voltage": string|null, "amps": string|null, "watts": string|null, "hz": string|null, "phase": string|null},
 "extra": [{"key": string, "value": string}]}`;

/** Pull the JSON object out of a model reply that may include prose or fences. */
export function parseModelJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const m = /\{[\s\S]*\}/.exec(content);
    if (!m) throw new BadGatewayException('The AI did not return JSON');
    try {
      return JSON.parse(m[0]);
    } catch {
      throw new BadGatewayException('The AI returned malformed JSON');
    }
  }
}

@Injectable()
export class LabelScanService {
  private readonly logger = new Logger(LabelScanService.name);

  constructor(private readonly ai: AiSettingsService) {}

  async status(): Promise<LabelScanStatusDto> {
    const s = await this.ai.get();
    const provider = this.ai.provider(s);
    return {
      enabled: !!provider,
      provider: s.provider,
      host: provider?.host ?? null,
      model: provider?.label ?? null,
      maxImageEdge: s.scan.maxImageEdge,
    };
  }

  async scan(image: Buffer, mimeType: string): Promise<LabelScanResultDto> {
    const settings = await this.ai.get();
    const provider = this.ai.provider(settings);
    if (!provider) {
      throw new ServiceUnavailableException(
        'Scan label needs an AI provider — choose one in Settings → AI.'
      );
    }
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
      throw new BadRequestException(`Unsupported image type ${mimeType}; use JPEG, PNG or WebP`);
    }
    if (image.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`Image is too large (${image.length} bytes)`);
    }

    const started = Date.now();
    let content: string;
    try {
      content = await provider.read({
        image,
        mimeType,
        prompt: PROMPT,
        jsonSchema: RESPONSE_SCHEMA,
        jsonShapeHint: JSON_SHAPE_HINT,
      });
    } catch (err) {
      if (err instanceof VisionError) throw new BadGatewayException(`${provider.label}: ${err.message}`);
      throw err;
    }
    const fields = normalizeFields(parseModelJson(content));
    const durationMs = Date.now() - started;
    this.logger.log(
      `Label scan via ${settings.provider}/${provider.label} in ${durationMs} ms: ` +
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
      model: provider.label,
      durationMs,
    };
  }
}
