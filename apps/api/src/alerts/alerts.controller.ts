import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext, type AuthedRequest } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import { AlertsService } from './alerts.service';
import { CorrectiveActionsService } from './corrective-actions.service';
import {
  AlertNoteDto,
  AlertQuery,
  AssignAlertDto,
  CloseCorrectiveActionDto,
  CorrectiveActionQuery,
  CreateAlertRuleDto,
  CreateCorrectiveActionDto,
  GisQuery,
  ResolveAlertDto,
  SubmitCorrectiveActionDto,
  UpdateAlertRuleDto,
  UpdateCorrectiveActionDto,
} from './dto';
import { GisService } from './gis.service';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);
const uuid = new ParseUUIDPipe();

@ApiTags('alerts')
@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly actions: CorrectiveActionsService,
    private readonly gis: GisService,
  ) {}

  @Get('alert-rules')
  @RequirePermissions('alert.view', 'alert.rule.manage')
  rules(@CurrentAuth() a: AuthContext) {
    return this.alerts.listRules(a);
  }

  @Post('alert-rules')
  @RequirePermissions('alert.rule.manage')
  createRule(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateAlertRuleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.createRule(a, dto, rid(req));
  }

  @Patch('alert-rules/:id')
  @RequirePermissions('alert.rule.manage')
  updateRule(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateAlertRuleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.updateRule(a, id, dto, rid(req));
  }

  @Post('alert-rules/evaluate')
  @RequirePermissions('alert.rule.manage')
  evaluate(@CurrentAuth() a: AuthContext, @Req() req: AuthedRequest) {
    return this.alerts.evaluateNow(a, rid(req));
  }

  @Get('alerts')
  @RequirePermissions('alert.view')
  list(@CurrentAuth() a: AuthContext, @Query() q: AlertQuery) {
    return this.alerts.list(a, q);
  }

  @Get('alerts/:id')
  @RequirePermissions('alert.view')
  get(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.alerts.get(a, id);
  }

  @Post('alerts/:id/acknowledge')
  @RequirePermissions('alert.assign')
  acknowledge(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: AlertNoteDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.acknowledge(a, id, dto, rid(req));
  }

  @Post('alerts/:id/assign')
  @RequirePermissions('alert.assign')
  assign(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: AssignAlertDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.assign(a, id, dto, rid(req));
  }

  @Post('alerts/:id/escalate')
  @RequirePermissions('alert.assign')
  escalate(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: AlertNoteDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.escalate(a, id, dto, rid(req));
  }

  @Post('alerts/:id/resolve')
  @RequirePermissions('alert.resolve')
  resolve(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ResolveAlertDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.resolve(a, id, dto, rid(req));
  }

  @Post('alerts/:id/reopen')
  @RequirePermissions('alert.resolve')
  reopen(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ResolveAlertDto,
    @Req() req: AuthedRequest,
  ) {
    return this.alerts.reopen(a, id, dto, rid(req));
  }

  @Get('corrective-actions')
  caList(@CurrentAuth() a: AuthContext, @Query() q: CorrectiveActionQuery) {
    return this.actions.list(a, q);
  }

  @Get('corrective-actions/:id')
  caGet(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.actions.get(a, id);
  }

  @Post('corrective-actions')
  @RequirePermissions('alert.assign')
  caCreate(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateCorrectiveActionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.actions.create(a, dto, rid(req));
  }

  @Patch('corrective-actions/:id')
  caUpdate(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCorrectiveActionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.actions.update(a, id, dto, rid(req));
  }

  @Post('corrective-actions/:id/submit-for-verification')
  caSubmit(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: SubmitCorrectiveActionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.actions.submit(a, id, dto, rid(req));
  }

  @Post('corrective-actions/:id/close')
  @RequirePermissions('alert.resolve')
  caClose(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: CloseCorrectiveActionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.actions.close(a, id, dto, rid(req));
  }

  @Get('gis/schemes')
  @RequirePermissions('scheme.view')
  gisSchemes(@CurrentAuth() a: AuthContext, @Query() q: GisQuery) {
    return this.gis.schemes(a, q);
  }

  @Get('gis/schemes/:id')
  @RequirePermissions('scheme.view')
  gisScheme(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.gis.scheme(a, id);
  }
}
