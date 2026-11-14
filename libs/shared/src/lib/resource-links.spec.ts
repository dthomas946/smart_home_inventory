import { buildResourceLinks } from './resource-links';

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

  it('URL-encodes manufacturer and model', () => {
    const links = buildResourceLinks({ manufacturer: 'A&B Co', model: 'X/1 2' });
    for (const link of links) {
      expect(link.url).not.toMatch(/[ &]X\/1/);
      expect(() => new URL(link.url)).not.toThrow();
    }
  });
});
