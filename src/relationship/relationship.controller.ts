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

@Controller('relationships')
export class RelationshipController {
  constructor(private readonly service: RelationshipService) {}

  @Get('resource/:resourceId')
  async queryByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
    @Query('requestId') requestId?: string,
  ): Promise<{ jobId: number }> {
    return this.service.queryByResource(resourceId, requestId);
  }

  @Get('project/:projectId')
  async queryByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Query('resourceIds') resourceIdsStr?: string,
    @Query('requestId') requestId?: string,
  ): Promise<{ jobId: number }> {
    const resourceIds = resourceIdsStr
      ? resourceIdsStr.split(',').map(Number).filter(Boolean)
      : undefined;
    return this.service.queryByProject(projectId, resourceIds, requestId);
  }

  @Post()
  async createRelationship(
    @Body()
    dto: {
      subjectId: number;
      predicate: string;
      objectId: number;
      resourceId: number;
      projectId?: number;
      requestId?: string;
    },
  ): Promise<{ jobId: number }> {
    return this.service.createRelationship(dto);
  }

  @Put()
  async updateRelationship(
    @Body()
    dto: {
      subjectId: number;
      predicate: string;
      objectId: number;
      newPredicate: string;
      resourceId: number;
      requestId?: string;
    },
  ): Promise<{ jobId: number }> {
    return this.service.updateRelationship(dto);
  }

  @Delete()
  async deleteRelationship(
    @Body()
    dto: {
      subjectId: number;
      predicate: string;
      objectId: number;
      resourceId: number;
      requestId?: string;
    },
  ): Promise<{ jobId: number }> {
    return this.service.deleteRelationship(dto);
  }

  @Post('resource/:resourceId/extract')
  async extractRelationships(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<{ jobId: number }> {
    return this.service.extractRelationships(resourceId);
  }
}
