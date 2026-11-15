import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import {
  NetworkLayoutMode,
  NetworkLayoutModeSchema,
  SaveNetworkLayoutDto,
  SaveNetworkLayoutSchema,
  SetAutoLinkRulesDto,
  SetAutoLinkRulesSchema,
} from '@smart-home-inventory/shared';
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

  /** Remove every auto-created link. Manual links and overrides are kept. */
  @Delete('managed')
  removeAllManaged() {
    return this.autoLink.removeAllManaged();
  }

  @Get('graph')
  graph() {
    return this.autoLink.graph();
  }

  /** Hand-arranged Network map positions for a layout mode. */
  @Get('layout/:mode')
  getLayout(@Param('mode', zodPipe(NetworkLayoutModeSchema)) mode: NetworkLayoutMode) {
    return this.autoLink.getLayout(mode);
  }

  @Put('layout/:mode')
  saveLayout(
    @Param('mode', zodPipe(NetworkLayoutModeSchema)) mode: NetworkLayoutMode,
    @Body(zodPipe(SaveNetworkLayoutSchema)) dto: SaveNetworkLayoutDto
  ) {
    return this.autoLink.saveLayout(mode, dto.positions);
  }

  @Delete('layout/:mode')
  resetLayout(@Param('mode', zodPipe(NetworkLayoutModeSchema)) mode: NetworkLayoutMode) {
    return this.autoLink.resetLayout(mode);
  }
}
