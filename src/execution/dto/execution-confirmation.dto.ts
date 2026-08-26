import { IsIn } from 'class-validator';

export class DecideExecutionConfirmationDto {
  @IsIn(['approved', 'denied'])
  decision: 'approved' | 'denied';
}
