import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileStorageService } from './file-storage.service';

describe('FileStorageService.sniffMime', () => {
  const svc = Object.create(FileStorageService.prototype) as FileStorageService;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sniff-'));
  const write = (name: string, bytes: Buffer) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, bytes);
    return p;
  };

  it('recognises a PDF the browser labelled octet-stream', async () => {
    const p = write('m.pdf', Buffer.from('%PDF-1.7\n%âãÏÓ\n'));
    await expect(svc.sniffMime(p, 'application/octet-stream')).resolves.toBe('application/pdf');
    await expect(svc.sniffMime(p, 'application/x-pdf')).resolves.toBe('application/pdf');
  });

  it('recognises JPEG and PNG', async () => {
    const jpg = write('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]));
    const png = write('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]));
    await expect(svc.sniffMime(jpg, '')).resolves.toBe('image/jpeg');
    await expect(svc.sniffMime(png, 'application/octet-stream')).resolves.toBe('image/png');
  });

  it('keeps the declared type when the content is unrecognised', async () => {
    const p = write('n.txt', Buffer.from('hello world'));
    await expect(svc.sniffMime(p, 'text/plain')).resolves.toBe('text/plain');
  });

  it('keeps the declared type when the file is missing', async () => {
    await expect(svc.sniffMime(path.join(tmp, 'nope'), 'image/heic')).resolves.toBe('image/heic');
  });
});
