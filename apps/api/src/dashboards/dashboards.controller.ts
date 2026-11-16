import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import { DashboardQuery, SchemeListQuery } from './dto';
import { DashboardsService } from './dashboards.service';

const uuid = new ParseUUIDPipe();

@ApiTags('dashboards')
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('state')
  @RequirePermissions('report.view')
  state(@CurrentAuth() a: AuthContext, @Query() q: DashboardQuery) {
    return this.dashboards.state(a, q);
  }

  @Get('district/:id')
  @RequirePermissions('report.view')
  district(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Query() q: DashboardQuery,
  ) {
    return this.dashboards.jurisdiction(a, id, q);
  }

  @Get('co-district/:id')
  @RequirePermissions('report.view')
  coDistrict(
    @CurrentAuth() a: AuthContext,
    @Param('id', uuid) id: string,
    @Query() q: DashboardQuery,
  ) {
    return this.dashboards.jurisdiction(a, id, q);
  }

  @Get('scheme/:id')
  @RequirePermissions('report.view')
  scheme(@CurrentAuth() a: AuthContext, @Param('id', uuid) id: string, @Query() q: DashboardQuery) {
    return this.dashboards.scheme(a, id, q);
  }

  @Get('schemes')
  @RequirePermissions('report.view')
  schemes(@CurrentAuth() a: AuthContext, @Query() q: SchemeListQuery) {
    return this.dashboards.schemes(a, q);
  }

  @Get('filter-options')
  @RequirePermissions('report.view')
  filterOptions(@CurrentAuth() a: AuthContext) {
    return this.dashboards.filterOptions(a);
  }

  @Get('kpi-definitions')
  @RequirePermissions('report.view')
  definitions() {
    return this.dashboards.kpiDefinitions();
  }

  @Get('reporting-completeness')
  @RequirePermissions('report.view')
  completeness(@CurrentAuth() a: AuthContext, @Query() q: DashboardQuery) {
    return this.dashboards.reportingCompleteness(a, q);
  }
}
