import { IsInt, Max, Min } from 'class-validator';

export class ReconcileExecutionOperationsDto {
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
