import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { RelationshipService } from './relationship.service';
import {
  CreateRelationshipDto,
  UpdateRelationshipDto,
  DeleteRelationshipDto,
} from './dto/relationship.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('relationships')
export class RelationshipController {
  constructor(private readonly service: RelationshipService) {}

  @Get('all')
  async queryAll(
    @Query('requestId') requestId?: string,
  ): Promise<{ executionId: string }> {
    return this.service.queryAll(requestId);
  }

  @Get('resource/:resourceId')
  async queryByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
    @Query('requestId') requestId?: string,
  ): Promise<{ executionId: string }> {
    return this.service.queryByResource(resourceId, requestId);
  }

  @Get('project/:projectId')
  async queryByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('resourceIds') resourceIdsStr?: string,
    @Query('requestId') requestId?: string,
  ): Promise<{ executionId: string }> {
    const resourceIds = resourceIdsStr
      ? resourceIdsStr.split(',').map(Number).filter(Boolean)
      : undefined;
    return this.service.queryByProject(projectId, resourceIds, requestId);
  }

  @Get('neighborhood')
  async queryNeighborhood(
    @Query('names') namesStr: string,
    @Query('requestId') requestId?: string,
  ): Promise<{ executionId: string }> {
    const entityNames = namesStr
      ? namesStr
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
      : [];
    return this.service.queryNeighborhood(entityNames, requestId);
  }

  @Post()
  @RequirePermissions(Permission.RELATIONSHIPS)
  async createRelationship(
    @Body() dto: CreateRelationshipDto,
  ): Promise<{ executionId: string }> {
    return this.service.createRelationship(dto);
  }

  @Put()
  @RequirePermissions(Permission.RELATIONSHIPS)
  async updateRelationship(
    @Body() dto: UpdateRelationshipDto,
  ): Promise<{ executionId: string }> {
    return this.service.updateRelationship(dto);
  }

  @Delete()
  @RequirePermissions(Permission.RELATIONSHIPS)
  async deleteRelationship(
    @Body() dto: DeleteRelationshipDto,
  ): Promise<{ executionId: string }> {
    return this.service.deleteRelationship(dto);
  }

  @Post('resource/:resourceId/extract')
  @RequirePermissions(Permission.RELATIONSHIPS)
  async extractRelationships(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<{ executionId: string }> {
    return this.service.extractRelationships(resourceId);
  }

  @Post('project/:projectId/extract')
  @RequirePermissions(Permission.RELATIONSHIPS)
  async extractRelationshipsForProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<{ executionIds: string[] }> {
    return this.service.extractRelationshipsForProject(projectId);
  }
}
