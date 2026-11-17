import { Injectable } from '@nestjs/common';
import { Prisma } from '@smart-home-inventory/prisma';
import { PrismaService } from '../prisma/prisma.service';

/** Tiny JSON key-value store for settings edited in the app. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string): Promise<T | null> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const json = value as unknown as Prisma.InputJsonValue;
    await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }
}
