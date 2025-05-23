import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JobProcessor } from './job-processor.interface';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class JobProcessorFactory implements OnModuleInit {
  private readonly logger = new Logger(JobProcessorFactory.name);
  private readonly processors: JobProcessor[] = [];

  constructor(private readonly moduleRef: ModuleRef) { }

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
              const processor = this.moduleRef.get(processorModule[processorName], { strict: false });

              if (processor && typeof processor.canProcess === 'function') {
                this.registerProcessor(processor);
                this.logger.log(`Registered processor: ${processorName}`);
              }
            } catch (err) {
              this.logger.error(`Failed to register processor from file ${file}: ${err.message}`);
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
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    return pascalCase;
  }

  /**
   * Register a job processor
   * @param processor The processor to register
   */
  private registerProcessor(processor: JobProcessor): void {
    this.processors.push(processor);
  }

  /**
   * Get the appropriate processor for a job type
   * @param jobType The type of job to process
   * @returns The processor for the job type or undefined if no processor is found
   */
  getProcessor(jobType: string): JobProcessor | undefined {
    const processor = this.processors.find(p => p.canProcess(jobType));

    if (!processor) {
      this.logger.warn(`No processor found for job type: ${jobType}`);
      return undefined;
    }

    return processor;
  }
}