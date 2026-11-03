import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { MembershipRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, MaxLength } from 'class-validator';
import { Roles } from '../shared/decorators/roles.decorator';
import { OrganizationsService } from './organizations.service';

class UpdateMembershipRoleDto {
  @ApiProperty({ enum: MembershipRole })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}

class AddOrganizationMemberDto {
  @ApiProperty({ example: 'member@example.com', description: 'Email of an already registered user.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('api/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':organizationId')
  @ApiOperation({ summary: 'Get the active organization' })
  getOrganization(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.organizationsService.findOne(organizationId);
  }

  @Get(':organizationId/members')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'List organization members (owner or admin)' })
  listMembers(@Param('organizationId', ParseUUIDPipe) organizationId: string) {
    return this.organizationsService.listMembers(organizationId);
  }

  @Post(':organizationId/members')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  @ApiOperation({ summary: 'Add an existing user to the organization as a member (owner or admin)' })
  addMember(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: AddOrganizationMemberDto,
  ) {
    return this.organizationsService.addMember(organizationId, dto.email);
  }

  @Patch(':organizationId/members/:membershipId/role')
  @Roles(MembershipRole.OWNER)
  @ApiOperation({ summary: 'Change an organization member role (owner only)' })
  updateRole(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: UpdateMembershipRoleDto,
  ) {
    return this.organizationsService.updateMemberRole(organizationId, membershipId, dto.role);
  }
}
