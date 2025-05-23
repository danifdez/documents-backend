import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly extractorPath = path.join(
    process.cwd(),
    'utilities/extractor.py',
  );

  /**
   * Extract content from a document file
   * @param filePath Path to the document file
   * @returns Extracted content as JSON
   */
  async extractDocument(filePath: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        this.logger.log(`Extracting content from file: ${filePath}`);

        const pythonProcess = spawn('python', [this.extractorPath, filePath]);

        let dataString = '';
        let errorString = '';

        pythonProcess.stdout.on('data', (data) => {
          dataString += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
          errorString += data.toString();
          this.logger.error(`Extraction error: ${data.toString()}`);
        });

        pythonProcess.on('close', (code) => {
          if (code !== 0) {
            if (errorString) {
              this.logger.error(`Error details: ${errorString}`);
            }
            resolve({ error: `Failed to extract document, process exited with code ${code}` });
            return;
          }

          try {
            const result = JSON.parse(dataString);
            resolve(result);
          } catch (parseError) {
            this.logger.error(`Failed to parse extraction result: ${parseError.message}`);
            resolve({ error: `Failed to parse extraction result: ${parseError.message}` });
          }
        });

        pythonProcess.on('error', (error) => {
          this.logger.error(`Failed to start Python process: ${error.message}`);
          resolve({ error: `Failed to start Python process: ${error.message}` });
        });
      } catch (error) {
        this.logger.error(`Failed to extract document: ${error.message}`);
        resolve({ error: `Failed to extract document: ${error.message}` });
      }
    });
  }
}
