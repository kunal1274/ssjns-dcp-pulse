import { Public } from '../auth/auth-context';
import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { LivenessResponse, ReadinessResponse } from '@dcp/shared';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Process is running (no dependency checks).' })
  live(): LivenessResponse {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOkResponse({ description: 'Database, PostGIS and migrations are ready.' })
  @ApiServiceUnavailableResponse({ description: 'A dependency is not ready.' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    res.status(result.status === 'ok' ? 200 : 503);
    return result;
  }
}
