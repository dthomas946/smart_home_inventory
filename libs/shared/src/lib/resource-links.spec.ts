import { brandSlug, buildResourceLinks } from './resource-links';

describe('buildResourceLinks', () => {
  it('returns nothing when there is nothing to search on', () => {
    expect(buildResourceLinks({})).toEqual([]);
    expect(buildResourceLinks({ manufacturer: '  ', model: null })).toEqual([]);
  });

  it('builds docs + parts + support links for an appliance with a model', () => {
    const links = buildResourceLinks({
      manufacturer: 'Whirlpool',
      model: 'WRF535SWHZ',
      category: 'appliance',
    });
    const groups = new Set(links.map((l) => l.group));
    expect(groups).toEqual(new Set(['docs', 'parts', 'support']));
    expect(links.find((l) => l.label === 'PartSelect')?.url).toContain('WRF535SWHZ');
    expect(links.find((l) => l.label === 'Whirlpool support')).toBeDefined();
  });

  it('skips parts houses for categories where they make no sense', () => {
    const links = buildResourceLinks({
      manufacturer: 'Aqara',
      model: 'WSDCGQ11LM',
      category: 'sensor',
    });
    expect(links.some((l) => l.group === 'parts')).toBe(false);
    expect(links.some((l) => l.group === 'docs')).toBe(true);
  });

  it('links ManualsLib by brand page, not a guessed product URL', () => {
    const links = buildResourceLinks({ manufacturer: 'Jasco Products', model: '43090' });
    const brand = links.find((l) => l.label.startsWith('ManualsLib:'));
    expect(brand?.url).toBe('https://www.manualslib.com/brand/jasco-products/');
    expect(links.some((l) => l.url.includes('/products/'))).toBe(false);
  });

  it('slugs brand names the way ManualsLib does', () => {
    expect(brandSlug('Aeotec Ltd.')).toBe('aeotec-ltd');
    expect(brandSlug('  GE  ')).toBe('ge');
  });

  it('prefers brand over manufacturer for every link', () => {
    const links = buildResourceLinks({
      manufacturer: 'Electrolux Home Products',
      brand: 'Frigidaire',
      model: 'FSC23F7TDS3',
      category: 'appliance',
    });
    expect(links.find((l) => l.label.endsWith(' support'))?.label).toBe('Frigidaire support');
    expect(links.find((l) => l.label.startsWith('ManualsLib:'))?.url).toContain('/brand/frigidaire/');
    expect(links.some((l) => /electrolux/i.test(l.url))).toBe(false);
  });

  it('URL-encodes manufacturer and model', () => {
    const links = buildResourceLinks({ manufacturer: 'A&B Co', model: 'X/1 2' });
    for (const link of links) {
      expect(link.url).not.toMatch(/[ &]X\/1/);
      expect(() => new URL(link.url)).not.toThrow();
    }
  });
});
