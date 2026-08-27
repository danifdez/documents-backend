import { IsString, MaxLength, MinLength } from 'class-validator';

export class WithdrawExecutionEvidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  reason: string;
}
