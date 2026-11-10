import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateMemoryEntryDto, UpdateMemoryEntryDto } from './dto/memory.dto';
import { MemoryEntryEntity } from './memory-entry.entity';
import { MemoryOwnerType, MemoryService } from './memory.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ownerPrincipalFromUser } from '../auth/owner-principal';
import {
  AgentOwnedGuard,
  AssistantOwnedGuard,
} from '../auth/guards/owned-resource.guard';

abstract class OwnerMemoryController {
  protected abstract readonly ownerType: MemoryOwnerType;

  constructor(protected readonly service: MemoryService) {}

  @Get()
  @RequirePermissions(Permission.ASK)
  list(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @CurrentUser() user: unknown,
  ): Promise<MemoryEntryEntity[]> {
    return this.service.list(
      this.ownerType,
      ownerId,
      ownerPrincipalFromUser(user),
    );
  }

  @Post()
  @RequirePermissions(Permission.WRITE)
  create(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Body() dto: CreateMemoryEntryDto,
    @CurrentUser() user: unknown,
  ): Promise<MemoryEntryEntity> {
    return this.service.create(
      this.ownerType,
      ownerId,
      dto,
      ownerPrincipalFromUser(user),
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.WRITE)
  update(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemoryEntryDto,
    @CurrentUser() user: unknown,
  ): Promise<MemoryEntryEntity> {
    return this.service.update(
      this.ownerType,
      ownerId,
      id,
      dto,
      ownerPrincipalFromUser(user),
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.WRITE)
  remove(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: unknown,
  ): Promise<void> {
    return this.service.remove(
      this.ownerType,
      ownerId,
      id,
      ownerPrincipalFromUser(user),
    );
  }

  @Delete()
  @RequirePermissions(Permission.WRITE)
  clear(
    @Param('ownerId', ParseIntPipe) ownerId: number,
    @CurrentUser() user: unknown,
  ): Promise<{ deleted: number }> {
    return this.service.clear(
      this.ownerType,
      ownerId,
      ownerPrincipalFromUser(user),
    );
  }
}

@Controller('assistants/:ownerId/memory')
@UseGuards(AssistantOwnedGuard)
export class AssistantMemoryController extends OwnerMemoryController {
  protected readonly ownerType = 'assistant' as const;
}

@Controller('agents/:ownerId/memory')
@UseGuards(AgentOwnedGuard)
export class AgentMemoryController extends OwnerMemoryController {
  protected readonly ownerType = 'agent' as const;
}
