import { Injectable, Logger } from '@nestjs/common';
import { JobProcessor } from '../job-processor.interface';
import { NotificationGateway } from 'src/notification/notification.gateway';
import { ResourceService } from 'src/resource/resource.service';
import { JobEntity } from 'src/job/job.entity';

@Injectable()
export class ImageGenerateProcessor implements JobProcessor {
  private readonly logger = new Logger(ImageGenerateProcessor.name);
  private readonly JOB_TYPE = 'image-generate';

  constructor(
    private readonly notificationGateway: NotificationGateway,
    private readonly resourceService: ResourceService,
  ) { }

  canProcess(jobType: string): boolean {
    return jobType === this.JOB_TYPE;
  }

  async process(job: JobEntity): Promise<any> {
    const result = job.result as {
      hash: string;
      relativePath: string;
      extension: string;
      width: number;
      height: number;
      prompt: string;
      requestId?: string;
    };
    const projectId = job.payload['projectId'] as number | undefined;

    if (!result || !result.hash) {
      throw new Error('Job result missing required image data');
    }

    const promptLabel = result.prompt?.length > 50
      ? result.prompt.substring(0, 50) + '...'
      : result.prompt;

    // Create a temporary resource record — file lives in temp/ until promoted
    const resource = await this.resourceService.create({
      name: `AI: ${promptLabel}`,
      hash: result.hash,
      path: result.relativePath,
      mimeType: 'image/png',
      type: 'image',
      status: 'temp',
      ...(projectId ? { project: { id: projectId } as any } : {}),
    });

    this.logger.log(
      `Image generated: resourceId=${resource.id}, hash=${result.hash.substring(0, 12)}`,
    );

    this.notificationGateway.sendImageGenerateResponse({
      requestId: result.requestId,
      resourceId: resource.id,
      width: result.width,
      height: result.height,
      prompt: result.prompt,
    });

    return { success: true, resourceId: resource.id };
  }
}
