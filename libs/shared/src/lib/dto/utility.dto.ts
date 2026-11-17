import { z } from 'zod';

/**
 * Utilities a home is supplied with. Each has its own Network map view
 * (connection types tagged with that utility), its own hand-drawn plans
 * (Diagrams owned by the utility) and a list of service providers.
 */
export const UTILITY_KINDS = ['electrical', 'gas', 'water', 'phone', 'internet', 'solar'] as const;
export const UtilityKindSchema = z.enum(UTILITY_KINDS);
export type UtilityKind = z.infer<typeof UtilityKindSchema>;

export const UTILITY_LABELS: Record<UtilityKind, string> = {
  electrical: 'Electrical',
  gas: 'Gas',
  water: 'Water',
  phone: 'Phone',
  internet: 'Internet',
  solar: 'Solar',
};

export function isUtilityKind(v: unknown): v is UtilityKind {
  return typeof v === 'string' && (UTILITY_KINDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Service providers
// ---------------------------------------------------------------------------

const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const UtilityProviderSchema = z.object({
  utility: UtilityKindSchema,
  name: z.string().trim().min(1).max(200),
  accountNumber: opt(100),
  phone: opt(50),
  /** Outage / emergency line, e.g. gas leak or power outage reporting. */
  emergencyPhone: opt(50),
  email: opt(200),
  website: opt(500),
  /** Outage map or status page. */
  outageUrl: opt(500),
  notes: opt(5000),
});
export type CreateUtilityProviderDto = z.input<typeof UtilityProviderSchema>;
export const UpdateUtilityProviderSchema = UtilityProviderSchema.partial();
export type UpdateUtilityProviderDto = z.input<typeof UpdateUtilityProviderSchema>;

export interface UtilityProviderDto {
  id: string;
  utility: UtilityKind;
  name: string;
  accountNumber: string | null;
  phone: string | null;
  emergencyPhone: string | null;
  email: string | null;
  website: string | null;
  outageUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One utility's overview for the Utilities page. */
export interface UtilitySummaryDto {
  utility: UtilityKind;
  providers: UtilityProviderDto[];
  /** Connection types shown on this utility's map. */
  connectionTypes: string[];
  connectionCount: number;
  diagrams: Array<{ id: string; title: string; updatedAt: string }>;
}

// ---------------------------------------------------------------------------
// Electrical circuits (kept in Connection.metadata.circuit)
// ---------------------------------------------------------------------------

export const CircuitSchema = z.object({
  /** Breaker / fuse position in the panel, e.g. "12" or "12/14" or "F7". */
  breaker: z.string().trim().max(30).nullish(),
  amps: z.number().positive().max(1000).nullish(),
  /** 1 = 120 V, 2 = 240 V double-pole, 3 = three-phase. */
  poles: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
  /** Area(s) the circuit feeds, beyond the connected device's own area. */
  servesAreaIds: z.array(z.string()).max(50).nullish(),
  /** Free text when it isn't one area: "Kitchen counter outlets". */
  serves: z.string().trim().max(200).nullish(),
});
export type CircuitDto = z.infer<typeof CircuitSchema>;

/** Read a circuit out of connection metadata (tolerates junk). */
export function circuitOf(metadata: unknown): CircuitDto | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const parsed = CircuitSchema.safeParse((metadata as Record<string, unknown>)['circuit']);
  if (!parsed.success) return null;
  const c = parsed.data;
  return c.breaker || c.amps || c.poles || c.servesAreaIds?.length || c.serves ? c : null;
}

/** "#12 · 20A 2-pole" — empty string when there's nothing. */
export function circuitSummary(c: CircuitDto | null | undefined): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.breaker) parts.push(`#${c.breaker.replace(/^#/, '')}`);
  const size = [c.amps ? `${c.amps}A` : '', c.poles && c.poles > 1 ? `${c.poles}-pole` : ''].filter(Boolean).join(' ');
  if (size) parts.push(size);
  return parts.join(' · ');
}

/** Default utility for the built-in (and common North American) connection
 *  types; used when seeding. Users can re-assign any type in Settings. */
export const DEFAULT_TYPE_UTILITY: Record<string, UtilityKind> = {
  mains_230v: 'electrical',
  mains_120v: 'electrical',
  mains_240v: 'electrical',
  ac_24v: 'electrical',
  dc_24v: 'electrical',
  dc_12v: 'electrical',
  gas: 'gas',
  water_cold: 'water',
  water_hot: 'water',
  water_waste: 'water',
  phone_line: 'phone',
  ethernet: 'internet',
  wifi: 'internet',
  coax: 'internet',
  fiber: 'internet',
  solar_dc: 'solar',
};
