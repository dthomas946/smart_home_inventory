import { Injectable, Logger } from '@nestjs/common';

export interface DclProduct {
  vendorName: string | null;
  productName: string | null;
  productLabel: string | null;
  partNumber: string | null;
  userManualUrl: string | null;
  supportUrl: string | null;
  productUrl: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Looks up a Matter product (vendor id + product id from its setup QR code)
 * in the CSA Distributed Compliance Ledger — the public registry every
 * certified Matter product is listed in. Read-only, cached in memory.
 */
@Injectable()
export class MatterDclService {
  private readonly logger = new Logger(MatterDclService.name);
  private readonly cache = new Map<string, DclProduct | null>();
  private readonly base = (process.env['MATTER_DCL_URL'] || 'https://on.dcl.csa-iot.org').replace(/\/+$/, '');

  async lookup(vendorId: number, productId: number): Promise<DclProduct | null> {
    // 0xFFF1–0xFFF4 are test vendor ids: never in the ledger.
    if (vendorId >= 0xfff1 && vendorId <= 0xfff4) return null;
    const key = `${vendorId}/${productId}`;
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const [model, vendor] = await Promise.all([
      this.get(`/dcl/model/models/${vendorId}/${productId}`),
      this.get(`/dcl/vendorinfo/vendors/${vendorId}`),
    ]);
    const m = ((model as Record<string, unknown> | null)?.['model'] ?? model) as Record<string, unknown> | null;
    const v = ((vendor as Record<string, unknown> | null)?.['vendorInfo'] ?? vendor) as Record<string, unknown> | null;
    const result: DclProduct | null =
      m || v
        ? {
            vendorName: str(v?.['companyPreferredName']) ?? str(v?.['vendorName']) ?? str(v?.['companyLegalName']),
            productName: str(m?.['productName']),
            productLabel: str(m?.['productLabel']),
            partNumber: str(m?.['partNumber']),
            userManualUrl: str(m?.['userManualUrl']),
            supportUrl: str(m?.['supportUrl']),
            productUrl: str(m?.['productUrl']),
          }
        : null;
    this.cache.set(key, result);
    this.logger.log(
      `Matter DCL ${key}: ${result ? `${result.vendorName ?? '?'} / ${result.productName ?? '?'}` : 'not found'}`
    );
    return result;
  }

  private async get(path: string): Promise<unknown> {
    try {
      const res = await fetch(`${this.base}${path}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      this.logger.warn(`Matter DCL ${path}: ${(err as Error).message}`);
      return null;
    }
  }
}
