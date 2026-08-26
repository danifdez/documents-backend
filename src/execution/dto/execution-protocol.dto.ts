import {
  Allow,
  ArrayNotEmpty,
  Equals,
  IsArray,
  IsBase64,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ExecutionStepKind } from '../execution-step-kind.enum';

export class RegisterModelsWorkerDto {
  @Equals('step-protocol/1')
  protocolVersion: 'step-protocol/1';

  @IsUUID()
  workerId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @IsString({ each: true })
  capabilities: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ExecutionStepKind, { each: true })
  stepKinds: ExecutionStepKind[];

  @IsInt()
  @Min(1)
  @Max(64)
  maximumConcurrency: number;

  @IsObject()
  metadata: Record<string, unknown>;
}

export class ModelsWorkerHeartbeatDto {
  @Equals('step-protocol/1')
  protocolVersion: 'step-protocol/1';

  @IsArray()
  @IsString({ each: true })
  capabilities: string[];

  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ExecutionStepKind, { each: true })
  stepKinds: ExecutionStepKind[];

  @IsInt()
  @Min(1)
  @Max(64)
  maximumConcurrency: number;

  @IsObject()
  metadata: Record<string, unknown>;
}

export class ClaimExecutionStepDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(ExecutionStepKind, { each: true })
  stepKinds: ExecutionStepKind[];

  @IsArray()
  @IsString({ each: true })
  capabilities: string[];

  @IsInt()
  @Min(1_000)
  @Max(900_000)
  leaseDurationMs: number;
}

export class RenewExecutionStepLeaseDto {
  @IsInt()
  @Min(1_000)
  @Max(900_000)
  leaseDurationMs: number;
}

export class ReceiveExecutionStepResultDto {
  @Equals('step-result/1')
  schemaVersion: 'step-result/1';

  @IsUUID()
  executionId: string;

  @IsUUID()
  stepId: string;

  @IsUUID()
  operationId: string;

  @IsUUID()
  attemptId: string;

  @IsEnum(ExecutionStepKind)
  stepKind: ExecutionStepKind;

  @IsIn(['succeeded', 'failed', 'cancelled'])
  status: string;

  @ValidateIf(
    (result: ReceiveExecutionStepResultDto) =>
      result.stepKind === ExecutionStepKind.INFERENCE ||
      result.codeFingerprint !== undefined,
  )
  @IsString()
  @Matches(/^sha256:[0-9a-f]{64}$/)
  codeFingerprint?: string;

  @IsString()
  @Matches(/^sha256:[0-9a-f]{64}$/)
  runtimeFingerprint: string;

  @IsArray()
  artifactRefs: Record<string, unknown>[];

  @Allow()
  error: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  output?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  usage?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  inference?: Record<string, unknown>;
}

export class UploadExecutionOutputArtifactDto {
  @IsUUID()
  artifactId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  kind: string;

  @IsString()
  @Matches(/^sha256:[0-9a-f]{64}$/)
  contentHash: string;

  @IsInt()
  @Min(0)
  @Max(8 * 1024 * 1024)
  size: number;

  @Equals('application/json')
  mediaType: 'application/json';

  @IsString()
  @IsBase64()
  bodyBase64: string;
}
