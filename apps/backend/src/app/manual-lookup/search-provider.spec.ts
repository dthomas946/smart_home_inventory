import { parseDdgHtml, scoreCandidate, unwrapDdgRedirect } from './search-provider';

const FIXTURE = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.carrier.com%2Fresidential%2Fen%2Fus%2Fproducts%2Fac%2F24ACC6%2F&amp;rut=abc">Carrier 24ACC6 Air Conditioner</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.carrier.com%2F&amp;rut=abc">Product page for the <b>24ACC6</b> central air conditioner.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fimages.carriercms.com%2Fimage%2Fupload%2F24ACC6-01SI.pdf&amp;rut=def">24ACC6 Installation Instructions</a>
    </h2>
    <a class="result__snippet" href="#">Installation, start-up and service instructions for <b>24ACC6</b> units (PDF).</a>
  </div>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://www.youtube.com/watch?v=xyz">Carrier 24ACC6 review video</a>
  <a class="result__snippet" href="#">Watch my review of this unit.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fimages.carriercms.com%2Fimage%2Fupload%2F24ACC6-01SI.pdf%3Fv%3D2&amp;rut=dup">Duplicate PDF with query string</a>
</div>
`;

describe('unwrapDdgRedirect', () => {
  it('decodes the uddg redirect target', () => {
    expect(
      unwrapDdgRedirect('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa.pdf&amp;rut=1')
    ).toBe('https://example.com/a.pdf');
  });
  it('passes through direct URLs', () => {
    expect(unwrapDdgRedirect('https://example.com/x')).toBe('https://example.com/x');
  });
  it('returns null on garbage', () => {
    expect(unwrapDdgRedirect('::not a url::')).toBeNull();
  });
});

describe('parseDdgHtml', () => {
  const terms = ['Carrier', '24ACC6', 'manual'];

  it('extracts title, url, host, snippet and pdf flag', () => {
    const results = parseDdgHtml(FIXTURE, terms);
    const pdf = results.find((r) => r.isPdf);
    expect(pdf).toBeDefined();
    expect(pdf?.host).toBe('images.carriercms.com');
    expect(pdf?.title).toBe('24ACC6 Installation Instructions');
    expect(pdf?.snippet).toContain('Installation, start-up');
  });

  it('ranks the PDF installation manual above the product page and the video', () => {
    const results = parseDdgHtml(FIXTURE, terms);
    expect(results[0].isPdf).toBe(true);
    const video = results.find((r) => r.host === 'youtube.com');
    expect(video).toBeDefined();
    expect(video!.score).toBeLessThan(results[0].score);
  });

  it('de-duplicates URLs that differ only by query string', () => {
    const results = parseDdgHtml(FIXTURE, terms);
    const pdfs = results.filter((r) => r.url.includes('24ACC6-01SI.pdf'));
    expect(pdfs).toHaveLength(1);
  });

  it('returns an empty list for a page with no results', () => {
    expect(parseDdgHtml('<html><body>No results.</body></html>', terms)).toEqual([]);
  });
});

describe('scoreCandidate', () => {
  it('rewards manual-ish wording and model tokens, penalises shopping/review hits', () => {
    const good = scoreCandidate(
      {
        title: 'WRF535SWHZ Use and Care Guide',
        url: 'https://whirlpool.com/x/WRF535SWHZ.pdf',
        snippet: 'Owner manual',
        isPdf: true,
        host: 'whirlpool.com',
      },
      ['Whirlpool', 'WRF535SWHZ']
    );
    const bad = scoreCandidate(
      {
        title: 'Buy Whirlpool fridge - best price',
        url: 'https://ebay.com/itm/123',
        snippet: 'reviews and prices',
        isPdf: false,
        host: 'ebay.com',
      },
      ['Whirlpool', 'WRF535SWHZ']
    );
    expect(good).toBeGreaterThan(bad);
  });
});
