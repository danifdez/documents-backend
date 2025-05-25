import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class JobProcessorClientService {
  private readonly JOB_PROCESSOR_URL = 'http://jobs:8000';

  constructor(
    private readonly http: HttpService,
  ) { }

  async post(url: string, request: any): Promise<any> {
    const response = await firstValueFrom(this.http.post(`${this.JOB_PROCESSOR_URL}/${url}`, request));
    return response.data;
  }
}
