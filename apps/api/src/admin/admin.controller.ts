import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, type AuthContext, type AuthedRequest } from '../auth/auth-context';
import { RequirePermissions } from '../authz/permissions.guard';
import { AdminService } from './admin.service';
import { AssignRoleScopeDto, CreateRoleDto, RevokeDto, UpdateRoleDto, UserStatusDto } from './dto';

const rid = (req: AuthedRequest) => (typeof req.id === 'string' ? req.id : undefined);

@ApiTags('access-control')
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('permissions')
  @RequirePermissions('role.manage', 'user.manage')
  permissions() {
    return this.admin.permissionCatalogue();
  }

  @Get('roles')
  @RequirePermissions('role.manage', 'user.manage')
  roles(@CurrentAuth() a: AuthContext) {
    return this.admin.listRoles(a);
  }

  @Post('roles')
  @RequirePermissions('role.manage')
  createRole(@CurrentAuth() a: AuthContext, @Body() dto: CreateRoleDto, @Req() req: AuthedRequest) {
    return this.admin.createRole(a, dto, rid(req));
  }

  @Patch('roles/:id')
  @RequirePermissions('role.manage')
  updateRole(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: AuthedRequest,
  ) {
    return this.admin.updateRole(a, id, dto, rid(req));
  }

  @Get('users')
  @RequirePermissions('user.manage')
  users(@CurrentAuth() a: AuthContext) {
    return this.admin.listUsers(a);
  }

  @Patch('users/:id/status')
  @RequirePermissions('user.manage')
  status(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserStatusDto,
    @Req() req: AuthedRequest,
  ) {
    return this.admin.setUserStatus(a, id, dto, rid(req));
  }

  @Post('users/:id/role-scopes')
  @RequirePermissions('user.manage')
  assign(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleScopeDto,
    @Req() req: AuthedRequest,
  ) {
    return this.admin.assignRoleScope(a, id, dto, rid(req));
  }

  @Delete('users/:id/role-scopes/:scopeId')
  @RequirePermissions('user.manage')
  revoke(
    @CurrentAuth() a: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('scopeId', ParseUUIDPipe) scopeId: string,
    @Body() dto: RevokeDto,
    @Req() req: AuthedRequest,
  ) {
    return this.admin.revokeRoleScope(a, id, scopeId, dto?.reason, rid(req));
  }

  @Get('jurisdictions')
  jurisdictions(@CurrentAuth() a: AuthContext) {
    return this.admin.jurisdictions(a);
  }

  @Get('agencies')
  agencies(@CurrentAuth() a: AuthContext) {
    return this.admin.agencies(a);
  }
}
