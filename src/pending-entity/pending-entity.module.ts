import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PendingEntityController } from './pending-entity.controller';
import { PendingEntityService } from './pending-entity.service';
import { EntityModule } from '../entity/entity.module';
import { ResourceModule } from '../resource/resource.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
    imports: [DatabaseModule, EntityModule, ResourceModule, ExecutionModule],
    controllers: [PendingEntityController],
    providers: [PendingEntityService],
    exports: [PendingEntityService],
})
export class PendingEntityModule { }
