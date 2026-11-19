import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LabelScanService } from './label-scan.service';

interface MemoryFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller('label-scan')
export class LabelScanController {
  constructor(private readonly labelScan: LabelScanService) {}

  @Get('status')
  status() {
    return this.labelScan.status();
  }

  /**
   * Multipart: `image` (optional photo, held in memory and sent to the AI,
   * never stored) and `codes` (optional JSON array of QR/barcode texts the
   * browser read from the photo). At least one is needed.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })
  )
  scan(@UploadedFile() file: MemoryFile | undefined, @Body('codes') codesField?: string) {
    let codes: string[] = [];
    if (codesField) {
      try {
        const parsed = JSON.parse(codesField);
        if (Array.isArray(parsed)) codes = parsed.filter((c): c is string => typeof c === 'string');
      } catch {
        throw new BadRequestException('codes must be a JSON array of strings');
      }
    }
    if (!file && codes.length === 0) throw new BadRequestException('Send an image, codes, or both');
    return this.labelScan.scan(file?.buffer ?? null, file?.mimetype ?? null, codes);
  }
}
