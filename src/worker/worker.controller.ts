import { Controller, Get } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { WorkerRegistrationView } from './worker-registration.types';

@Controller('workers')
export class WorkerController {
  constructor(private readonly workers: WorkerService) {}

  @Get()
  async findAll(): Promise<WorkerRegistrationView[]> {
    return this.workers.registrations();
  }
}
