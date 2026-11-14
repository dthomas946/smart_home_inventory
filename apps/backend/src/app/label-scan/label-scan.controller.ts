import {
  BadRequestException,
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

  /** Multipart field `image`. Held in memory — it's sent to Ollama, not stored;
   *  the frontend attaches the photo separately once the device exists. */
  @Post()
  @UseInterceptors(
    FileInterceptor('image', { storage: memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })
  )
  scan(@UploadedFile() file: MemoryFile | undefined) {
    if (!file) throw new BadRequestException('image field is required');
    return this.labelScan.scan(file.buffer, file.mimetype);
  }
}
