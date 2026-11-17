/**
 * "Scan label": photograph a device's rating plate / nameplate and have a
 * local vision model (Ollama) read it into structured fields that prefill
 * the device form. Everything is a suggestion — the user reviews before save.
 */

export interface LabelScanStatusDto {
  /** False when no AI provider is configured; the UI hides the buttons. */
  enabled: boolean;
  /** Which provider will read the label (Settings → AI). */
  provider: string;
  /** Host:port only — never leaks a path or credentials into the UI. */
  host: string | null;
  /** Model or HA entity doing the reading, for the progress message. */
  model: string | null;
  /** Shrink photos to this longest edge before sending. */
  maxImageEdge: number;
}

export interface LabelScanElectrical {
  voltage: string | null;
  amps: string | null;
  watts: string | null;
  hz: string | null;
  phase: string | null;
}

export interface LabelScanFields {
  manufacturer: string | null;
  /** Brand/logo on the plate when it differs from the manufacturer line. */
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  /** Free-text product type as printed, e.g. "Split System Air Conditioner". */
  productType: string | null;
  /** As printed; may be a month/year or a date code. */
  manufactureDate: string | null;
  electrical: LabelScanElectrical;
  /** HVAC/appliance specifics when present: refrigerant, charge, BTU, capacity, gas type… */
  extra: Record<string, string>;
}

export interface LabelScanResultDto {
  fields: LabelScanFields;
  /** Ready-to-append notes block built from electrical + extra. */
  notesSuggestion: string;
  /** Best-effort category guess from productType, or null. */
  categorySuggestion: string | null;
  model: string;
  durationMs: number;
}
