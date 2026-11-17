import { DeviceCategory } from './enums';

/**
 * External "look it up" links for a physical device — manuals, parts, support.
 *
 * Pure URL templating from manufacturer + model: nothing is fetched and no
 * result is stored. The point is to make the non-smart gear (fridge, HVAC
 * unit, water heater) one tap away from its documentation and spare parts
 * without hand-building search queries every time.
 *
 * Parts houses are US-centric; that's where the manufacturers' model-number
 * search actually works well. The groups are open for extension — adding a
 * regional parts source is a one-line change here, not a backend change.
 */

export type ResourceLinkGroup = 'docs' | 'parts' | 'support';

export interface ResourceLink {
  group: ResourceLinkGroup;
  label: string;
  url: string;
}

export interface ResourceLinkInput {
  manufacturer?: string | null;
  /** Preferred over manufacturer for every link: parts houses and manual
   *  sites index by brand (Frigidaire), not the legal maker (Electrolux). */
  brand?: string | null;
  /** 'us' = US/Canada parts retailers + CPSC recalls; 'generic' (default for
   *  everywhere else) = web searches that work in any country. */
  region?: 'us' | 'generic';
  model?: string | null;
  category?: DeviceCategory | null;
}

/** Categories where appliance/HVAC parts houses are a sensible destination. */
const PARTS_CATEGORIES: ReadonlySet<DeviceCategory> = new Set<DeviceCategory>([
  'appliance',
  'thermostat',
  'water_heater',
  'radiator',
  'fan',
  'air_handling_unit',
  'pump',
  'valve',
  'other',
]);

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/** "Jasco Products" → "jasco-products"; "Aeotec Ltd." → "aeotec-ltd". */
export function brandSlug(manufacturer: string): string {
  return clean(manufacturer)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function q(...parts: string[]): string {
  return encodeURIComponent(parts.filter(Boolean).join(' '));
}

/**
 * Returns an empty list when there is nothing to search on (no manufacturer
 * and no model), so callers can simply hide the section.
 */
export function buildResourceLinks(input: ResourceLinkInput): ResourceLink[] {
  // "manufacturer" below means the name we search by: brand when known.
  const manufacturer = clean(input.brand) || clean(input.manufacturer);
  const model = clean(input.model);
  if (!manufacturer && !model) return [];

  const mm = [manufacturer, model].filter(Boolean).join(' ');
  const links: ResourceLink[] = [];

  // --- Manuals & documentation -------------------------------------------
  links.push({
    group: 'docs',
    label: 'Web search: manual (PDF)',
    url: `https://duckduckgo.com/?q=${q(mm, 'manual', 'filetype:pdf')}`,
  });
  // ManualsLib has no plain-GET search; its brand index pages are stable and
  // a site-scoped web search finds the exact model page.
  links.push({
    group: 'docs',
    label: 'ManualsLib (search)',
    url: `https://duckduckgo.com/?q=${q('site:manualslib.com', mm)}`,
  });
  if (manufacturer) {
    links.push({
      group: 'docs',
      label: `ManualsLib: ${manufacturer}`,
      url: `https://www.manualslib.com/brand/${brandSlug(manufacturer)}/`,
    });
  }
  if (model) {
    links.push({
      group: 'docs',
      label: 'Web search: installation / service manual',
      url: `https://duckduckgo.com/?q=${q(mm, 'installation OR service manual')}`,
    });
  }

  // --- Parts ---------------------------------------------------------------
  const partsRelevant = !input.category || PARTS_CATEGORIES.has(input.category);
  const us = (input.region ?? 'us') === 'us';
  if (model && partsRelevant && !us) {
    links.push(
      {
        group: 'parts',
        label: 'Web search: spare parts',
        url: `https://duckduckgo.com/?q=${q(mm, 'spare parts')}`,
      },
      {
        group: 'parts',
        label: 'Web search: parts diagram',
        url: `https://duckduckgo.com/?q=${q(mm, 'parts diagram OR exploded view')}`,
      }
    );
  }
  if (model && partsRelevant && us) {
    links.push(
      {
        group: 'parts',
        label: 'RepairClinic',
        url: `https://www.repairclinic.com/Shop-For-Parts?query=${q(model)}`,
      },
      {
        group: 'parts',
        label: 'PartSelect',
        url: `https://www.partselect.com/Models/${q(model)}/`,
      },
      {
        group: 'parts',
        label: 'AppliancePartsPros',
        url: `https://www.appliancepartspros.com/search.aspx?model=${q(model)}`,
      },
      {
        group: 'parts',
        label: 'Encompass',
        url: `https://encompass.com/search?searchTerm=${q(model)}`,
      }
    );
  }

  // --- Manufacturer support --------------------------------------------------
  if (manufacturer) {
    links.push({
      group: 'support',
      label: `${manufacturer} support`,
      url: `https://duckduckgo.com/?q=${q(manufacturer, 'support', model)}`,
    });
    if (model && us) {
      links.push({
        group: 'support',
        label: 'Recalls (CPSC)',
        url: `https://www.cpsc.gov/Recalls?search_api_fulltext=${q(manufacturer, model)}`,
      });
    }
  }

  return links;
}

export const RESOURCE_LINK_GROUP_LABELS: Record<ResourceLinkGroup, string> = {
  docs: 'Manuals & docs',
  parts: 'Parts',
  support: 'Support',
};
