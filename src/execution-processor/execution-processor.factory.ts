import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ExecutionProcessor } from './execution-processor.interface';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ExecutionProcessorFactory implements OnModuleInit {
  private readonly logger = new Logger(ExecutionProcessorFactory.name);
  private readonly processors: ExecutionProcessor[] = [];

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    await this.registerProcessors();
  }

  /**
   * Dynamically register all processors from the processors directory
   */
  private async registerProcessors(): Promise<void> {
    try {
      const processorsPath = path.join(__dirname, 'processors');
      const files = fs.readdirSync(processorsPath);

      for (const file of files) {
        if (file.endsWith('.js')) {
          const processorName = this.getProcessorClassName(file);
          if (processorName) {
            try {
              const processorModule = await import(`./processors/${file}`);
              const processor = this.moduleRef.get(
                processorModule[processorName],
                { strict: false },
              );

              if (processor && typeof processor.canProcess === 'function') {
                this.registerProcessor(processor);
                this.logger.log(`Registered processor: ${processorName}`);
              }
            } catch (err) {
              this.logger.error(
                `Failed to register processor from file ${file}: ${err.message}`,
              );
            }
          }
        }
      }

      this.logger.log(`Total registered processors: ${this.processors.length}`);
    } catch (err) {
      this.logger.error(`Failed to load processors: ${err.message}`);
    }
  }

  /**
   * Extract class name from filename
   */
  private getProcessorClassName(filename: string): string | null {
    const name = filename.replace(/\.[^/.]+$/, '');

    const pascalCase = name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    return pascalCase;
  }

  /**
   * Register a execution processor
   * @param processor The processor to register
   */
  private registerProcessor(processor: ExecutionProcessor): void {
    this.processors.push(processor);
  }

  /**
   * Get the appropriate processor for a execution type
   * @param taskType The type of execution to process
   * @returns The processor for the execution type or undefined if no processor is found
   */
  getProcessor(taskType: string): ExecutionProcessor | undefined {
    const processor = this.processors.find((p) => p.canProcess(taskType));

    if (!processor) {
      this.logger.warn(`No processor found for execution type: ${taskType}`);
      return undefined;
    }

    return processor;
  }
}
