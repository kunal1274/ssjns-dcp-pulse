import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext, type AuthedRequest } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import {
  CorrectionDto,
  CreateCommitmentDto,
  CreateExpenditureDto,
  CreateReleaseDto,
  FinanceDecisionDto,
  FinanceQuery,
  ResubmitExpenditureDto,
  VersionDto,
} from './dto';
import { FinanceService } from './finance.service';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);
const IDEM = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Unique per logical write; retries replay the stored response',
};
const uuid = new ParseUUIDPipe();

@ApiTags('finance')
@Controller()
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('fund-releases')
  @RequirePermissions('scheme.view')
  releases(@CurrentAuth() a: AuthContext, @Query() q: FinanceQuery) {
    return this.finance.listReleases(a, q);
  }

  @Post('fund-releases')
  @RequirePermissions('release.record')
  @ApiHeader(IDEM)
  createRelease(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateReleaseDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.createRelease(a, dto, key, rid(req));
  }

  @Post('fund-releases/:id/decision')
  @RequirePermissions('expenditure.verify')
  @ApiHeader(IDEM)
  decideRelease(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: FinanceDecisionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.decideRelease(a, id, dto, key, rid(req));
  }

  @Post('fund-releases/:id/corrections')
  @RequirePermissions('release.record')
  @ApiHeader(IDEM)
  correctRelease(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: CorrectionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.correctRelease(a, id, dto, key, rid(req));
  }

  @Get('fund-releases/:id/decisions')
  @RequirePermissions('scheme.view')
  releaseDecisions(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.finance.decisions(a, 'fund_release', id);
  }

  @Get('expenditure')
  @RequirePermissions('scheme.view')
  expenditure(@CurrentAuth() a: AuthContext, @Query() q: FinanceQuery) {
    return this.finance.listExpenditure(a, q);
  }

  @Post('expenditure')
  @RequirePermissions('expenditure.submit')
  @ApiHeader(IDEM)
  createExpenditure(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateExpenditureDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.createExpenditure(a, dto, key, rid(req));
  }

  @Post('expenditure/:id/resubmit')
  @RequirePermissions('expenditure.submit')
  @ApiHeader(IDEM)
  resubmitExpenditure(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ResubmitExpenditureDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.resubmitExpenditure(a, id, dto, key, rid(req));
  }

  @Post('expenditure/:id/decision')
  @RequirePermissions('expenditure.verify')
  @ApiHeader(IDEM)
  decideExpenditure(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: FinanceDecisionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.decideExpenditure(a, id, dto, key, rid(req));
  }

  @Post('expenditure/:id/corrections')
  @RequirePermissions('expenditure.submit')
  @ApiHeader(IDEM)
  correctExpenditure(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: CorrectionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.correctExpenditure(a, id, dto, key, rid(req));
  }

  @Get('expenditure/:id/decisions')
  @RequirePermissions('scheme.view')
  expenditureDecisions(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.finance.decisions(a, 'expenditure_record', id);
  }

  @Get('commitments')
  @RequirePermissions('scheme.view')
  commitments(@CurrentAuth() a: AuthContext, @Query() q: FinanceQuery) {
    return this.finance.listCommitments(a, q);
  }

  @Post('commitments')
  @RequirePermissions('release.record')
  @ApiHeader(IDEM)
  createCommitment(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateCommitmentDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.createCommitment(a, dto, key, rid(req));
  }

  @Post('commitments/:id/cancel')
  @RequirePermissions('release.record')
  @ApiHeader(IDEM)
  cancelCommitment(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: VersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.finance.cancelCommitment(a, id, dto.version, key, rid(req));
  }

  @Get('schemes/:id/finance')
  @RequirePermissions('scheme.view')
  schemeFinance(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.finance.schemeFinance(a, id);
  }
}
