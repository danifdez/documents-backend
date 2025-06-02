import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class RagClientService {
  private readonly RAG_URL = 'http://rag:8000';

  constructor(private readonly http: HttpService) { }

  async post(url: string, request: any): Promise<any> {
    const response = await firstValueFrom(this.http.post(`${this.RAG_URL}/${url}`, request));
    return response.data;
  }
}
