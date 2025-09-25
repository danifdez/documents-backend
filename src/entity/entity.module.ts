import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EntityController } from './entity.controller';
import { EntityService } from './entity.service';
import { EntityTypeModule } from '../entity-type/entity-type.module';

@Module({
    imports: [DatabaseModule, EntityTypeModule],
    controllers: [EntityController],
    providers: [EntityService],
    exports: [EntityService],
})
export class EntityModule { }