import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import {
  AttachFromUrlDto,
  AttachmentDto,
  ManualSearchResultDto,
} from '@smart-home-inventory/shared';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as net from 'node:net';
import * as path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AttachmentsService } from '../attachments/attachments.service';
import { FileStorageService } from '../attachments/file-storage.service';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { DuckDuckGoProvider, SearchProvider } from './search-provider';

const FETCH_TIMEOUT_MS = 30_000;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** Hosts the add-on must never be talked into fetching from: itself, the
 *  Supervisor, HA core, and anything on a private/loopback address. The
 *  user is an admin on their own LAN, but a pasted URL shouldn't be able to
 *  pull Supervisor API responses into the attachments folder. */
function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http(s) URLs can be fetched');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === 'supervisor' ||
    host === 'homeassistant' ||
    host === 'hassio' ||
    !host.includes('.')
  ) {
    throw new BadRequestException('Refusing to fetch from a local or internal host');
  }
  if (net.isIP(host)) {
    if (
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      host === '::1' ||
      /^f[cd]/i.test(host) ||
      /^fe80/i.test(host)
    ) {
      throw new BadRequestException('Refusing to fetch from a private address');
    }
  }
  return url;
}

function filenameFrom(url: URL, contentDisposition: string | null, mimeType: string): string {
  const cd = contentDisposition ?? '';
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd)?.[1];
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1];
  let name = star ? safeDecode(star.trim()) : plain?.trim() ?? '';
  if (!name) name = path.basename(url.pathname) || 'download';
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);
  if (mimeType === 'application/pdf' && !/\.pdf$/i.test(name)) name += '.pdf';
  return name;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

@Injectable()
export class ManualLookupService {
  private readonly logger = new Logger(ManualLookupService.name);
  private readonly provider: SearchProvider = new DuckDuckGoProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly storage: FileStorageService,
    private readonly config: AppConfig
  ) {}

  /** Default query for a device: "<manufacturer> <model> manual". */
  async defaultQuery(deviceId: string): Promise<string> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { name: true, manufacturer: true, model: true },
    });
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);
    const parts = [device.manufacturer, device.model].map((p) => p?.trim()).filter(Boolean);
    if (parts.length === 0) {
      throw new BadRequestException(
        'Device has no manufacturer or model to search on — add one first, or paste a URL.'
      );
    }
    return `${parts.join(' ')} manual`;
  }

  async search(deviceId: string, override?: string): Promise<ManualSearchResultDto> {
    const query = override?.trim() || (await this.defaultQuery(deviceId));
    const candidates = await this.provider.search(query);
    return { query, provider: this.provider.name, candidates };
  }

  /**
   * Fetch a URL server-side and file it as an attachment. The byte stream is
   * written straight to the uploads dir with a hard size cap (same limit as
   * uploads); on any failure the partial file is removed. For kind=manual the
   * content must really be a PDF: content-type *or* the %PDF- magic bytes —
   * plenty of OEM servers serve PDFs as application/octet-stream.
   */
  async attachFromUrl(deviceId: string, dto: AttachFromUrlDto): Promise<AttachmentDto> {
    const url = assertPublicHttpUrl(dto.url);
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true },
    });
    if (!device) throw new NotFoundException(`Device ${deviceId} not found`);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*;q=0.8' },
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new BadGatewayException(`Could not fetch URL: ${(err as Error).message}`);
    }
    if (!res.ok || !res.body) {
      throw new BadGatewayException(`Remote server answered ${res.status}`);
    }

    const declaredLength = Number(res.headers.get('content-length') ?? '0');
    if (declaredLength > this.config.uploadMaxBytes) {
      throw new PayloadTooLargeException(
        `File is ${declaredLength} bytes; limit is ${this.config.uploadMaxBytes}`
      );
    }

    let mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const originalName = filenameFrom(url, res.headers.get('content-disposition'), mimeType);
    const storedName = this.storage.storedNameFor(originalName);
    const target = this.storage.absolutePath(storedName);

    let size = 0;
    let head: Buffer | null = null;
    const limit = this.config.uploadMaxBytes;
    const capped = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (head === null) head = Buffer.from(chunk.subarray(0, 8));
        if (size > limit) {
          cb(new PayloadTooLargeException(`File exceeds ${limit} bytes`));
          return;
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(Readable.fromWeb(res.body as never), capped, fs.createWriteStream(target));
    } catch (err) {
      await fsp.unlink(target).catch(() => undefined);
      if (err instanceof PayloadTooLargeException) throw err;
      throw new BadGatewayException(`Download failed: ${(err as Error).message}`);
    }

    const looksLikePdf =
      head !== null && (head as Buffer).subarray(0, 5).toString('latin1') === '%PDF-';
    if (looksLikePdf) mimeType = 'application/pdf';
    if (dto.kind === 'manual' && !looksLikePdf) {
      await fsp.unlink(target).catch(() => undefined);
      throw new BadRequestException(
        `That URL did not return a PDF (got ${mimeType || 'unknown type'}). ` +
          'Open it in a browser, find the direct PDF link, and paste that instead.'
      );
    }
    if (!mimeType) mimeType = 'application/octet-stream';

    this.logger.log(`Fetched ${size} bytes from ${url.hostname} for device ${deviceId}`);
    return this.attachments.createFromUpload(
      { deviceId },
      { filename: storedName, originalname: originalName, mimetype: mimeType, size, path: target },
      { kind: dto.kind, title: dto.title ?? null },
      url.href
    );
  }
}
