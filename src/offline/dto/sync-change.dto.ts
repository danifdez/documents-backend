import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SyncChangeDto {
  @IsIn(['doc', 'comment', 'mark', 'reading-point', 'note', 'resource'])
  entityType: string;

  @IsNumber()
  entityId: number;

  @IsIn(['PATCH', 'POST', 'DELETE'])
  method: string;

  @IsObject()
  payload: Record<string, any>;

  @IsDateString()
  updatedAt: string;
}

export class ApplySyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncChangeDto)
  changes: SyncChangeDto[];
}
