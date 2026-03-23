import { IsString, IsNumber, IsIn, IsObject, IsDateString } from 'class-validator';

export class SyncChangeDto {
  @IsIn(['doc', 'comment', 'mark', 'note', 'resource'])
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
