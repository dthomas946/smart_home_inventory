import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  CreateUtilityProviderDto,
  UpdateUtilityProviderDto,
  UpdateUtilityProviderSchema,
  UtilityProviderSchema,
} from '@smart-home-inventory/shared';
import { zodPipe } from '../common/zod-validation.pipe';
import { UtilitiesService } from './utilities.service';

@Controller('utilities')
export class UtilitiesController {
  constructor(private readonly utilities: UtilitiesService) {}

  @Get()
  list() {
    return this.utilities.summaries();
  }

  @Post('providers')
  create(@Body(zodPipe(UtilityProviderSchema)) _validated: unknown, @Body() raw: CreateUtilityProviderDto) {
    return this.utilities.create(raw);
  }

  @Patch('providers/:id')
  update(
    @Param('id') id: string,
    @Body(zodPipe(UpdateUtilityProviderSchema)) _validated: unknown,
    @Body() raw: UpdateUtilityProviderDto
  ) {
    return this.utilities.update(id, raw);
  }

  @Delete('providers/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.utilities.remove(id);
  }
}
