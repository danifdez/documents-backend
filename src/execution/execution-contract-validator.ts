import { BadRequestException, Injectable } from '@nestjs/common';
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

@Injectable()
export class ExecutionContractValidator {
  private readonly eventValidator: ValidateFunction;
  private readonly artifactValidator: ValidateFunction;
  private readonly bundleValidator: ValidateFunction;
  private readonly assignmentValidator: ValidateFunction;
  private readonly resultValidator: ValidateFunction;
  private readonly toolInvocationValidator: ValidateFunction;
  private readonly toolPlanValidator: ValidateFunction;
  private readonly toolResultValidator: ValidateFunction;

  constructor() {
    const root = this.resolveSchemaRoot();
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    for (const path of this.schemaPaths(root)) {
      ajv.addSchema(JSON.parse(readFileSync(path, 'utf8')));
    }
    this.eventValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/execution-event.schema.json',
    );
    this.artifactValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/artifact-manifest.schema.json',
    );
    this.bundleValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/execution-bundle.schema.json',
    );
    this.assignmentValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/step-assignment.schema.json',
    );
    this.resultValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/step-result.schema.json',
    );
    this.toolInvocationValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/tool-invocation.schema.json',
    );
    this.toolPlanValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/tool-plan.schema.json',
    );
    this.toolResultValidator = ajv.getSchema(
      'https://documents.local/harness/v1/schemas/tool-result.schema.json',
    );
    if (
      !this.eventValidator ||
      !this.artifactValidator ||
      !this.bundleValidator ||
      !this.assignmentValidator ||
      !this.resultValidator ||
      !this.toolInvocationValidator ||
      !this.toolPlanValidator ||
      !this.toolResultValidator
    ) {
      throw new Error('Canonical execution v1 schemas are incomplete');
    }
  }

  assertEvent(value: Record<string, unknown>): void {
    this.assert(this.eventValidator, value, 'event');
  }

  assertArtifact(value: Record<string, unknown>): void {
    this.assert(this.artifactValidator, value, 'artifact');
  }

  assertBundle(value: Record<string, unknown>): void {
    this.assert(this.bundleValidator, value, 'bundle');
  }

  assertStepAssignment(value: Record<string, unknown>): void {
    this.assert(this.assignmentValidator, value, 'step assignment');
  }

  assertStepResult(value: Record<string, unknown>): void {
    this.assert(this.resultValidator, value, 'step result');
  }

  assertToolInvocation(value: Record<string, unknown>): void {
    this.assert(this.toolInvocationValidator, value, 'tool invocation');
  }

  assertToolPlan(value: Record<string, unknown>): void {
    this.assert(this.toolPlanValidator, value, 'tool plan');
  }

  assertToolResult(value: Record<string, unknown>): void {
    this.assert(this.toolResultValidator, value, 'tool result');
  }

  private assert(
    validator: ValidateFunction,
    value: unknown,
    label: string,
  ): void {
    if (!validator(value)) {
      const details = validator.errors
        ?.map((error) => `${error.instancePath || '/'} ${error.message}`)
        .join('; ');
      throw new BadRequestException(
        `Invalid canonical execution ${label}: ${details}`,
      );
    }
  }

  private resolveSchemaRoot(): string {
    const candidates = [
      resolve(process.cwd(), 'contracts/execution/v1/schemas'),
      resolve(__dirname, '../../../contracts/execution/v1/schemas'),
    ];
    const root = candidates.find((candidate) => existsSync(candidate));
    if (!root)
      throw new Error('Canonical execution v1 schemas are unavailable');
    return root;
  }

  private schemaPaths(root: string): string[] {
    return readdirSync(root, { withFileTypes: true })
      .flatMap((entry) => {
        const child = join(root, entry.name);
        return entry.isDirectory()
          ? this.schemaPaths(child)
          : entry.name.endsWith('.json')
            ? [child]
            : [];
      })
      .sort();
  }
}
