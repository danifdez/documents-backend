import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ExecutionProcessor } from './execution-processor.interface';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

      const loaded = await Promise.all(
        files
          .filter((file) => file.endsWith('.js'))
          .map((file) => this.loadProcessor(file)),
      );
      for (const entry of loaded) {
        if (!entry) continue;
        this.registerProcessor(entry.processor);
        this.logger.log(`Registered processor: ${entry.name}`);
      }

      this.logger.log(`Total registered processors: ${this.processors.length}`);
    } catch (err) {
      this.logger.error(`Failed to load processors: ${err.message}`);
    }
  }

  private async loadProcessor(
    file: string,
  ): Promise<{ name: string; processor: ExecutionProcessor } | null> {
    const name = this.getProcessorClassName(file);
    if (!name) return null;
    try {
      const processorModule = await import(`./processors/${file}`);
      const processor = this.moduleRef.get(processorModule[name], {
        strict: false,
      });
      return processor && typeof processor.canProcess === 'function'
        ? { name, processor }
        : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to register processor from file ${file}: ${message}`,
      );
      return null;
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
