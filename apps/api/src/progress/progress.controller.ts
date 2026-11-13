import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext, type AuthedRequest } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import {
  CreateProgressDto,
  ProgressQuery,
  ProgressReturnDto,
  ProgressVersionDto,
  UpdateProgressDto,
} from './dto';
import { ProgressService } from './progress.service';
import { QueueService } from './queue.service';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);
const IDEM = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Unique per logical write; retries replay the stored response',
};
const uuid = new ParseUUIDPipe();

@ApiTags('progress')
@Controller()
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly queueService: QueueService,
  ) {}

  @Get('progress-submissions')
  @RequirePermissions('scheme.view')
  list(@CurrentAuth() a: AuthContext, @Query() q: ProgressQuery) {
    return this.progress.list(a, q);
  }

  @Get('progress-submissions/:id')
  @RequirePermissions('scheme.view')
  get(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.progress.get(a, id);
  }

  @Post('progress-submissions')
  @RequirePermissions('progress.submit')
  @ApiHeader(IDEM)
  create(
    @CurrentAuth() a: AuthContext,
    @Body() dto: CreateProgressDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.create(a, dto, key, rid(req));
  }

  @Patch('progress-submissions/:id')
  @RequirePermissions('progress.submit')
  update(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateProgressDto,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.update(a, id, dto, rid(req));
  }

  @Post('progress-submissions/:id/submit')
  @RequirePermissions('progress.submit')
  @ApiHeader(IDEM)
  submit(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ProgressVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.submit(a, id, dto.version, key, rid(req));
  }

  @Post('progress-submissions/:id/start-review')
  @RequirePermissions('progress.verify')
  @ApiHeader(IDEM)
  startReview(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ProgressVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.startReview(a, id, dto.version, key, rid(req));
  }

  @Post('progress-submissions/:id/verify')
  @RequirePermissions('progress.verify')
  @ApiHeader(IDEM)
  verify(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ProgressVersionDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.verify(a, id, dto.version, key, rid(req));
  }

  @Post('progress-submissions/:id/return')
  @RequirePermissions('progress.verify')
  @ApiHeader(IDEM)
  returnSubmission(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ProgressReturnDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.returnSubmission(a, id, dto, key, rid(req));
  }

  @Post('progress-submissions/:id/corrections')
  @RequirePermissions('progress.submit')
  @ApiHeader(IDEM)
  correct(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    return this.progress.correct(a, id, key, rid(req));
  }

  @Get('schemes/:id/progress')
  @RequirePermissions('scheme.view')
  schemeProgress(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.progress.schemeProgress(a, id);
  }

  @Get('verification-queue')
  @RequirePermissions('scheme.view')
  queue(@CurrentAuth() a: AuthContext) {
    return this.queueService.queue(a);
  }
}
