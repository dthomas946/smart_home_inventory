import jsQR from 'jsqr';

/** Formats worth reading off a device label (when the browser supports them). */
const WANTED_FORMATS = ['qr_code', 'data_matrix', 'aztec', 'pdf417', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

/**
 * Find QR codes and barcodes in a photo, in the browser. Uses the built-in
 * BarcodeDetector where there is one (Chrome on Android/macOS, Safari), which
 * reads several codes and barcode types at once; otherwise jsQR, which reads
 * one QR code. Never throws: no codes → [].
 */
export async function readCodes(file: File): Promise<string[]> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return [];
  }
  try {
    const BD = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (BD) {
      try {
        const supported = await BD.getSupportedFormats();
        const formats = WANTED_FORMATS.filter((f) => supported.includes(f));
        if (formats.length) {
          const found = await new BD({ formats }).detect(bitmap);
          const values = unique(found.map((b) => b.rawValue));
          if (values.length) return values;
        }
      } catch {
        // fall through to jsQR
      }
    }
    // jsQR works on raw pixels; try a few sizes — small QR codes on a big
    // photo need resolution, large ones decode faster smaller.
    for (const edge of [1600, 2600, 900]) {
      const value = qrAt(bitmap, edge);
      if (value) return [value];
      if (Math.max(bitmap.width, bitmap.height) <= edge) break;
    }
    return [];
  } finally {
    bitmap.close();
  }
}

function qrAt(bitmap: ImageBitmap, maxEdge: number): string | null {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const hit = jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
  return hit?.data?.trim() || null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}
