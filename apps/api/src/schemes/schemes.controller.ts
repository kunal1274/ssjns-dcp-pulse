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
import {
  CreateSchemeDto,
  SchemeDecisionDto,
  SchemeQuery,
  SchemeTransitionDto,
  UpdateSchemeDto,
  VersionDto,
} from './dto';
import { SchemesService } from './schemes.service';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);

@ApiTags('schemes')
@Controller('schemes')
export class SchemesController {
  constructor(private readonly schemes: SchemesService) {}

  @Get()
  @RequirePermissions('scheme.view')
  list(@CurrentAuth() a: AuthContext, @Query() q: SchemeQuery) {
    return this.schemes.list(a, q);
  }

  @Get(':id')
  @RequirePermissions('scheme.view')
  get(@CurrentAuth() a: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.schemes.get(a, id);
  }

  @Post()
  @RequirePermissions('scheme.create')
  create(@CurrentAuth() a: AuthContext, @Body() dto: CreateSchemeDto, @Req() req: AuthedRequest) {
    return this.schemes.create(a, dto, rid(req));
  }

  @Patch(':id')
  @RequirePermissions('scheme.edit')
  update(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSchemeDto,
    @Req() req: AuthedRequest,
  ) {
    return this.schemes.update(a, id, dto, rid(req));
  }

  @Post(':id/submit')
  @RequirePermissions('scheme.submit')
  submit(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VersionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.schemes.submit(a, id, dto.version, rid(req));
  }

  @Post(':id/decision')
  @RequirePermissions('scheme.approve')
  decide(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SchemeDecisionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.schemes.decide(a, id, dto, rid(req));
  }

  @Post(':id/transition')
  @RequirePermissions('scheme.approve')
  transition(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SchemeTransitionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.schemes.transition(a, id, dto, rid(req));
  }
}
