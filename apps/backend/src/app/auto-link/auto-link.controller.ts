import { Body, Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { SetAutoLinkRulesDto, SetAutoLinkRulesSchema } from '@smart-home-inventory/shared';
import { zodPipe } from '../common/zod-validation.pipe';
import { AutoLinkService } from './auto-link.service';

@Controller('auto-link')
export class AutoLinkController {
  constructor(private readonly autoLink: AutoLinkService) {}

  @Get('status')
  status() {
    return this.autoLink.status();
  }

  /** Dry run: what a re-run would create/update/remove, plus why devices were skipped. */
  @Get('plan')
  plan() {
    return this.autoLink.plan();
  }

  @Post('apply')
  apply() {
    return this.autoLink.apply();
  }

  @Get('rules')
  rules() {
    return this.autoLink.listRules();
  }

  @Put('rules')
  setRules(@Body(zodPipe(SetAutoLinkRulesSchema)) dto: SetAutoLinkRulesDto) {
    return this.autoLink.setRules(dto);
  }

  /** Clear user overrides so suppressed links may be recreated on the next run. */
  @Delete('suppressions')
  resetSuppressions() {
    return this.autoLink.resetSuppressions();
  }

  @Get('graph')
  graph() {
    return this.autoLink.graph();
  }
}
