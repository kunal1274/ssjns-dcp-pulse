import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext, type AuthedRequest } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import { ImportCommitDto, ImportPreviewDto } from './dto';
import { ImportsService } from './imports.service';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);
const uuid = new ParseUUIDPipe();

@ApiTags('imports')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('sources')
  @RequirePermissions('integration.manage')
  sources(@CurrentAuth() a: AuthContext) {
    return this.imports.sources(a);
  }

  @Post('preview')
  @RequirePermissions('integration.manage')
  preview(@CurrentAuth() a: AuthContext, @Body() dto: ImportPreviewDto, @Req() req: AuthedRequest) {
    return this.imports.preview(a, dto, rid(req));
  }

  @Post(':id/commit')
  @RequirePermissions('integration.manage')
  commit(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Body() dto: ImportCommitDto,
    @Req() req: AuthedRequest,
  ) {
    return this.imports.commit(a, id, dto, rid(req));
  }

  @Get()
  @RequirePermissions('integration.manage')
  list(@CurrentAuth() a: AuthContext) {
    return this.imports.list(a);
  }

  @Get(':id')
  @RequirePermissions('integration.manage')
  get(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string) {
    return this.imports.get(a, id);
  }
}
