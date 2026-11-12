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
import { BudgetService } from './budget.service';
import {
  AllocationQuery,
  CancelDto,
  CeilingQuery,
  CreateAllocationDto,
  CreateCeilingDto,
  CreateFundingRequestDto,
  CreateRevisionDto,
  DecisionDto,
  ReviewFundingRequestDto,
  VersionBody,
} from './dto';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);
const IDEM = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Unique per logical write; retries replay the stored response',
};
const VIEW = ['scheme.view', 'budget.allocate'];

@ApiTags('budget')
@Controller('budget')
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  @Get('financial-years')
  @RequirePermissions(...VIEW)
  financialYears(@CurrentAuth() a: AuthContext) {
    return this.budget.financialYears(a);
  }

  @Get('periods')
  @RequirePermissions(...VIEW, 'budget.request.create')
  periods(@CurrentAuth() a: AuthContext) {
    return this.budget.periods(a);
  }

  @Get('ceilings')
  @RequirePermissions(...VIEW)
  ceilings(@CurrentAuth() a: AuthContext, @Query() q: CeilingQuery) {
    return this.budget.listCeilings(a, q.financialYearId);
  }

  @Post('ceilings')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.allocate')
  createCeiling(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateCeilingDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.createCeiling(a, dto, key, rid(req));
  }

  @Post('ceilings/:id/approve')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.allocate')
  approveCeiling(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionBody,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.approveCeiling(a, id, dto.version, key, rid(req));
  }

  @Get('allocations')
  @RequirePermissions(...VIEW)
  allocations(@CurrentAuth() a: AuthContext, @Query() q: AllocationQuery) {
    return this.budget.listAllocations(a, q);
  }

  @Get('allocations/:id/history')
  @RequirePermissions(...VIEW)
  history(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budget.allocationHistory(a, id);
  }

  @Post('allocations')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.allocate')
  createAllocation(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateAllocationDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.createAllocation(a, dto, key, rid(req));
  }

  @Post('allocations/:id/approve')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.allocate')
  approveAllocation(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionBody,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.approveAllocation(a, id, dto.version, key, rid(req));
  }

  @Post('allocations/:id/cancel')
  @RequirePermissions('budget.allocate')
  cancelAllocation(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.cancelAllocation(a, id, dto, rid(req));
  }

  @Get('revisions')
  @RequirePermissions('budget.revise')
  revisions(@CurrentAuth() a: AuthContext, @Query('status') status?: string) {
    return this.budget.listRevisions(a, status);
  }

  @Post('revisions')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.revise')
  createRevision(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateRevisionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.createRevision(a, dto, key, rid(req));
  }

  @Post('revisions/:id/decision')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.revise')
  decideRevision(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.decideRevision(a, id, dto, key, rid(req));
  }

  @Get('requests')
  @RequirePermissions('scheme.view')
  requests(@CurrentAuth() a: AuthContext) {
    return this.budget.listFundingRequests(a);
  }

  @Post('requests')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.request.create')
  createRequest(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateFundingRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.createFundingRequest(a, dto, key, rid(req));
  }

  @Post('requests/:id/review')
  @ApiHeader(IDEM)
  @RequirePermissions('budget.request.review')
  reviewRequest(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewFundingRequestDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.budget.reviewFundingRequest(a, id, dto, key, rid(req));
  }
}
