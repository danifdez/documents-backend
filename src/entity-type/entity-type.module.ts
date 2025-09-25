import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EntityTypeController } from './entity-type.controller';
import { EntityTypeService } from './entity-type.service';

@Module({
    imports: [DatabaseModule],
    controllers: [EntityTypeController],
    providers: [EntityTypeService],
    exports: [EntityTypeService],
})
export class EntityTypeModule { }