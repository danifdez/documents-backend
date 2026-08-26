import {
  Equals,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class EnrollBrowserWorkerDto {
  @Equals('step-protocol/1')
  protocolVersion: 'step-protocol/1';

  @IsUUID()
  installationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsObject()
  metadata: Record<string, unknown>;
}

export class BrowserWorkerHeartbeatDto {
  @Equals('step-protocol/1')
  protocolVersion: 'step-protocol/1';

  @IsObject()
  metadata: Record<string, unknown>;
}

export class ClaimBrowserWorkDto {
  @Equals('step-protocol/1')
  protocolVersion: 'step-protocol/1';

  @IsInt()
  @Min(1_000)
  @Max(900_000)
  leaseDurationMs: number;

  @IsInt()
  @Min(0)
  @Max(30_000)
  waitTimeoutMs: number;
}

export class RequestBrowserPageReadDto {
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2_048)
  expectedUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50_000)
  maxChars?: number;
}
