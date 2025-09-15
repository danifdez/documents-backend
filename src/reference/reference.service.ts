import { Injectable } from '@nestjs/common';
import { ResourceService } from '../resource/resource.service';
import { MarkService } from '../mark/mark.service';

@Injectable()
export class ReferenceService {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly markService: MarkService,
  ) {}

  async search(query: string): Promise<any[]> {
    if (!query || !query.trim()) return [];

    const resources = await this.resourceService.search(query);
    const marks = await this.markService.search(query);

    const merged: any[] = [
      ...resources.map((r: any) => ({
        id: r.id,
        type: 'resource' as const,
        name: r.name,
      })),
      ...marks.map((m: any) => ({
        id: m.id,
        type: 'mark' as const,
        content: m.content,
      })),
    ].filter((item) => item.id != null);

    return merged;
  }
}
