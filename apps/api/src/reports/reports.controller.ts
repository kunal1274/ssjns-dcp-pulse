import { Controller, Get, Param, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth, type AuthContext, type AuthedRequest } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import { ExportQuery, ReportQuery } from './dto';
import { ReportsService } from './reports.service';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('report.view')
  list(@CurrentAuth() a: AuthContext) {
    return this.reports.definitions(a);
  }

  @Get('executions')
  @RequirePermissions('report.export', 'audit.view')
  executions(@CurrentAuth() a: AuthContext) {
    return this.reports.executions(a);
  }

  @Get(':code')
  @RequirePermissions('report.view')
  preview(@CurrentAuth() a: AuthContext, @Param('code') code: string, @Query() q: ReportQuery) {
    return this.reports.preview(a, code, q);
  }

  /** Generated on request and streamed; nothing is stored, so there is no file URL to leak. */
  @Get(':code/export')
  @RequirePermissions('report.export')
  async export(
    @CurrentAuth() a: AuthContext,
    @Param('code') code: string,
    @Query() q: ExportQuery,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { format, ...filters } = q;
    const out = await this.reports.export(a, code, filters, format, rid(req));
    res.set({
      'Content-Type': out.contentType,
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Report-Rows': String(out.rows),
    });
    return new StreamableFile(out.body);
  }
}
