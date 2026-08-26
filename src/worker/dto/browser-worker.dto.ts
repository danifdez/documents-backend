import {
  Equals,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
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
