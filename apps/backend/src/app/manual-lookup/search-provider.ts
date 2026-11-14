import { Logger } from '@nestjs/common';
import { ManualCandidateDto } from '@smart-home-inventory/shared';

/**
 * Web search for product documentation, used by the manual-lookup feature.
 *
 * DuckDuckGo's HTML endpoint is the provider: no API key, no account, and it
 * answers plain GETs. The price is that it's screen-scraping — the markup
 * is stable but not a contract, so the parser is deliberately loose (regex
 * over anchors, never a full DOM) and every failure mode degrades to "no
 * candidates" rather than an exception. The UI always offers paste-a-URL as
 * the fallback for exactly that reason.
 */

const DDG_HTML = 'https://html.duckduckgo.com/html/';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const MAX_CANDIDATES = 8;

const POSITIVE_TERMS: Array<[RegExp, number]> = [
  [/\bmanual\b/i, 3],
  [/\b(owner'?s?|user'?s?|use\s*(and|&)\s*care)\b/i, 2],
  [/\b(installation|install|service|parts list|wiring|spec(ification)?s?)\b/i, 2],
  [/\bpdf\b/i, 1],
  [/\b(guide|instructions|datasheet|data sheet)\b/i, 1],
];
const NEGATIVE_TERMS: Array<[RegExp, number]> = [
  [/\b(review|reviews|forum|reddit|youtube|video|ebay|amazon|price|buy|for sale)\b/i, 3],
  [/\b(scribd)\b/i, 2],
];
/** Aggregator sites that are fine but less trustworthy than the OEM. */
const AGGREGATOR_HOSTS = /(manualslib|manualzz|manualsonline|manua\.ls|manualowl|manualsdir)/i;

export interface SearchProvider {
  readonly name: string;
  search(query: string): Promise<ManualCandidateDto[]>;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** DDG wraps result hrefs in a redirect: //duckduckgo.com/l/?uddg=<url>&rut=… */
export function unwrapDdgRedirect(href: string): string | null {
  const raw = decodeHtml(href);
  try {
    // Protocol-relative and root-relative hrefs are DDG's own; anything else
    // must be absolute to count as a result.
    const u = raw.startsWith('//')
      ? new URL(`https:${raw}`)
      : raw.startsWith('/')
        ? new URL(raw, 'https://duckduckgo.com')
        : new URL(raw);
    if (/duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith('/l/')) {
      const target = u.searchParams.get('uddg');
      return target ? target : null;
    }
    return u.href;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function scoreCandidate(
  c: Pick<ManualCandidateDto, 'title' | 'url' | 'snippet' | 'isPdf' | 'host'>,
  terms: string[]
): number {
  const haystack = `${c.title} ${c.snippet ?? ''} ${c.url}`;
  let score = 0;
  if (c.isPdf) score += 4;
  for (const [re, w] of POSITIVE_TERMS) if (re.test(haystack)) score += w;
  for (const [re, w] of NEGATIVE_TERMS) if (re.test(haystack)) score -= w;
  if (AGGREGATOR_HOSTS.test(c.host)) score -= 1;
  // Each query term (manufacturer / model token) found in title or URL is a
  // strong signal the hit is about *this* device, not a sibling model.
  for (const t of terms) {
    if (t.length < 3) continue;
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(c.title) || re.test(c.url)) score += 2;
  }
  return score;
}

/** Parse DDG's HTML result page into candidates. Exported for unit tests. */
export function parseDdgHtml(html: string, terms: string[]): ManualCandidateDto[] {
  const results: ManualCandidateDto[] = [];
  const seen = new Set<string>();

  // Each result: <a rel="nofollow" class="result__a" href="…">Title</a> …
  //              <a class="result__snippet" href="…">snippet</a>
  const anchorRe =
    /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const anchors: Array<{ url: string; title: string; index: number }> = [];
  for (const m of html.matchAll(anchorRe)) {
    const url = unwrapDdgRedirect(m[1]);
    if (!url || !/^https?:/i.test(url)) continue;
    anchors.push({ url, title: stripTags(m[2]), index: m.index ?? 0 });
  }
  const snippets: Array<{ text: string; index: number }> = [];
  for (const m of html.matchAll(snippetRe)) {
    snippets.push({ text: stripTags(m[1]), index: m.index ?? 0 });
  }

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const next = anchors[i + 1]?.index ?? Number.POSITIVE_INFINITY;
    const snippet = snippets.find((s) => s.index > a.index && s.index < next)?.text ?? null;
    const key = a.url.replace(/[#?].*$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const host = hostOf(a.url);
    const isPdf = /\.pdf(\?|#|$)/i.test(a.url);
    const base = { title: a.title || a.url, url: a.url, host, snippet, isPdf };
    results.push({ ...base, score: scoreCandidate(base, terms) });
  }

  return results.sort((x, y) => y.score - x.score).slice(0, MAX_CANDIDATES);
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly name = 'duckduckgo';
  private readonly logger = new Logger(DuckDuckGoProvider.name);

  async search(query: string): Promise<ManualCandidateDto[]> {
    const terms = query.split(/\s+/).filter(Boolean);
    const url = `${DDG_HTML}?q=${encodeURIComponent(query)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
      });
    } catch (err) {
      this.logger.warn(`DuckDuckGo request failed: ${(err as Error).message}`);
      return [];
    }
    if (!res.ok) {
      this.logger.warn(`DuckDuckGo responded ${res.status}`);
      return [];
    }
    const html = await res.text();
    if (/anomaly-modal|bots use DuckDuckGo too/i.test(html)) {
      this.logger.warn('DuckDuckGo served a bot-check page instead of results');
      return [];
    }
    return parseDdgHtml(html, terms);
  }
}
