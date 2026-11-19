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
  LabelScanLinkDto,
  LabelScanResultDto,
  LabelScanStatusDto,
  parseScannedCode,
  ScannedCodeResultDto,
} from '@smart-home-inventory/shared';
import { AiSettingsService } from '../settings/ai-settings.service';
import { VisionError } from './vision-providers';
import { MatterDclService } from './matter-dcl.service';

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

  constructor(
    private readonly ai: AiSettingsService,
    private readonly dcl: MatterDclService
  ) {}

  async status(): Promise<LabelScanStatusDto> {
    const s = await this.ai.get();
    const provider = this.ai.provider(s);
    return {
      enabled: !!provider,
      provider: s.provider,
      host: provider?.host ?? null,
      model: provider?.label ?? null,
      maxImageEdge: s.scan.maxImageEdge,
      codes: true,
    };
  }

  /**
   * Read a label from its photo (AI, when one is set up) and/or the QR codes
   * and barcodes the browser found on it. Code results that come from a
   * registry (Matter DCL) are exact, so they win over what the AI read.
   */
  async scan(image: Buffer | null, mimeType: string | null, rawCodes: string[] = []): Promise<LabelScanResultDto> {
    const started = Date.now();
    const codes = await this.decodeCodes(rawCodes);
    const settings = await this.ai.get();
    const provider = image ? this.ai.provider(settings) : null;

    if (!provider && codes.length === 0) {
      throw new ServiceUnavailableException(
        image
          ? 'No QR code or barcode found, and reading the label text needs an AI provider (Settings → AI).'
          : 'Nothing to read: no photo and no code.'
      );
    }

    let aiFields: LabelScanFields | null = null;
    if (provider && image && mimeType) {
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
        throw new BadRequestException(`Unsupported image type ${mimeType}; use JPEG, PNG or WebP`);
      }
      if (image.length > MAX_IMAGE_BYTES) {
        throw new BadRequestException(`Image is too large (${image.length} bytes)`);
      }
      const hint = codes.length
        ? `\n\nCodes printed on this label were read by a barcode scanner (exact — prefer them over hard-to-read text):\n` +
          codes.map((c) => `- ${c.summary}${c.registryLine ? ` → ${c.registryLine}` : ''}`).join('\n')
        : '';
      try {
        const content = await provider.read({
          image,
          mimeType,
          prompt: PROMPT + hint,
          jsonSchema: RESPONSE_SCHEMA,
          jsonShapeHint: JSON_SHAPE_HINT,
        });
        aiFields = normalizeFields(parseModelJson(content));
      } catch (err) {
        if (err instanceof VisionError) {
          // A code alone can still fill the form; only fail when it can't.
          if (!codes.some((c) => c.fields)) throw new BadGatewayException(`${provider.label}: ${err.message}`);
          this.logger.warn(`Label scan AI failed, using codes only: ${err.message}`);
        } else throw err;
      }
    }

    const fromCodes = mergeCodeFields(codes.map((c) => c.fields).filter((f): f is Partial<LabelScanFields> => !!f));
    const fields = mergeFields(aiFields, fromCodes);
    const links = dedupeLinks(codes.flatMap((c) => c.links));
    const durationMs = Date.now() - started;
    const who = [aiFields && provider ? provider.label : null, codes.length ? 'QR/barcode' : null].filter(Boolean).join(' + ');
    this.logger.log(
      `Label scan via ${who} in ${durationMs} ms: ${fields.brand ?? fields.manufacturer ?? '?'} / ${fields.model ?? '?'}`
    );
    const notes = [
      buildNotes(fields),
      codes.length ? `Codes on label:\n${codes.map((c) => `- ${c.summary}`).join('\n')}` : '',
      links.length ? `Links:\n${links.map((l) => `- ${l.label}: ${l.url}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const categorySuggestion = guessCategory(fields.productType);
    return {
      fields,
      notesSuggestion: notes,
      categorySuggestion:
        categorySuggestion && (DEVICE_CATEGORIES as readonly string[]).includes(categorySuggestion)
          ? categorySuggestion
          : null,
      model: who,
      durationMs,
      codes: codes.map((c) => ({ kind: c.kind, summary: c.summary, registry: c.registry })),
      links,
    };
  }

  private async decodeCodes(raw: string[]): Promise<DecodedCode[]> {
    const unique = [...new Set(raw.map((r) => r.trim()).filter(Boolean))].slice(0, 10);
    return Promise.all(
      unique.map(async (text) => {
        const code = parseScannedCode(text);
        const out: DecodedCode = { kind: code.kind, summary: code.summary, fields: null, links: [], registry: null, registryLine: null };
        if (code.matter) {
          const p = await this.dcl.lookup(code.matter.vendorId, code.matter.productId);
          if (p) {
            out.registry = { vendorName: p.vendorName, productName: p.productName, partNumber: p.partNumber };
            out.registryLine = `Matter registry: ${[p.vendorName, p.productName, p.partNumber ? `part ${p.partNumber}` : null].filter(Boolean).join(', ')}`;
            const { brand, manufacturer } = brandFromRegistry(p.vendorName, p.productName);
            out.fields = {
              brand,
              manufacturer,
              model: p.partNumber ?? p.productName,
              productType: p.productLabel ?? p.productName,
            };
            if (p.userManualUrl) out.links.push({ label: 'Manual (Matter registry)', url: p.userManualUrl });
            if (p.supportUrl) out.links.push({ label: 'Support (Matter registry)', url: p.supportUrl });
            if (p.productUrl) out.links.push({ label: 'Product page (Matter registry)', url: p.productUrl });
          }
        } else if (code.zwave?.manufacturerName) {
          out.fields = { brand: code.zwave.manufacturerName };
        } else if (code.homekit?.categoryName) {
          out.fields = { productType: code.homekit.categoryName };
        } else if (code.gs1?.serial) {
          out.fields = { serialNumber: code.gs1.serial };
        }
        if (code.url) out.links.push({ label: 'Link from QR code', url: code.url });
        return out;
      })
    );
  }
}

interface DecodedCode {
  kind: ScannedCodeResultDto['kind'];
  summary: string;
  fields: Partial<LabelScanFields> | null;
  links: LabelScanLinkDto[];
  registry: ScannedCodeResultDto['registry'];
  registryLine: string | null;
}

function mergeCodeFields(list: Array<Partial<LabelScanFields>>): Partial<LabelScanFields> {
  const out: Partial<LabelScanFields> = {};
  for (const f of list) {
    for (const [k, v] of Object.entries(f) as Array<[keyof LabelScanFields, unknown]>) {
      if (v && !out[k]) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Registry/code identity (brand, model, product type) beats the AI's reading;
 * the AI fills everything else. A serial from a code only fills a gap, since
 * the AI may have read the printed one.
 */
export function mergeFields(ai: LabelScanFields | null, codes: Partial<LabelScanFields>): LabelScanFields {
  const base: LabelScanFields = ai ?? {
    manufacturer: null,
    brand: null,
    model: null,
    serialNumber: null,
    productType: null,
    manufactureDate: null,
    electrical: { voltage: null, amps: null, watts: null, hz: null, phase: null },
    extra: {},
  };
  return {
    ...base,
    brand: codes.brand ?? base.brand,
    manufacturer: base.manufacturer ?? codes.manufacturer ?? (ai ? null : codes.brand ?? null),
    model: codes.model ?? base.model,
    productType: codes.productType ?? base.productType,
    serialNumber: base.serialNumber ?? codes.serialNumber ?? null,
  };
}

/** First words of product names that describe the product, not a brand. */
const GENERIC_PRODUCT_WORDS = new Set(
  ('smart matter thread wifi wi-fi zigbee mini micro plug outlet socket light lamp led bulb strip switch dimmer ' +
    'sensor motion contact door window water leak temperature climate air thermostat lock video camera doorbell ' +
    'wireless outdoor indoor color colour white rgb rgbw rgbtw ultra pro max lite plus home hub bridge button ' +
    'remote controller control power energy blind shade curtain fan heater purifier speaker display panel').split(' ')
);

/**
 * The registry lists the company that certified the product, which is often
 * an OEM (e.g. "ChampOn" for an "Onvis Smart Plug S4"). When the product name
 * leads with a different name, that's the brand; the company is the maker.
 */
export function brandFromRegistry(
  vendorName: string | null,
  productName: string | null
): { brand: string | null; manufacturer: string | null } {
  const lead = productName?.trim().split(/\s+/)[0] ?? '';
  const looksLikeBrand =
    /^[A-Z][A-Za-z0-9&'.-]{2,}$/.test(lead) &&
    !GENERIC_PRODUCT_WORDS.has(lead.toLowerCase()) &&
    (productName?.trim().split(/\s+/).length ?? 0) > 1;
  if (vendorName && looksLikeBrand && !vendorName.toLowerCase().includes(lead.toLowerCase())) {
    return { brand: lead, manufacturer: vendorName };
  }
  return { brand: vendorName, manufacturer: vendorName };
}

function dedupeLinks(links: LabelScanLinkDto[]): LabelScanLinkDto[] {
  const seen = new Set<string>();
  return links.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}
