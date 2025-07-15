import { Injectable } from '@nestjs/common';
import { ResourceService } from '../resource/resource.service';
import { MarkService } from '../mark/mark.service';

@Injectable()
export class ReferenceService {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly markService: MarkService,
  ) { }

  async search(query: string) {
    if (!query || !query.trim()) return { resources: [], marks: [] };

    const resources = await this.resourceService.search(query);

    // Search marks by content
    const marks = await this.markService.search(query);

    const merged = [
      ...resources.map((r) => ({
        _id: r._id,
        type: 'resource',
        name: r.name,
      })),
      ...marks.map((m) => ({
        _id: m._id,
        type: 'mark',
        content: m.content,
      })),
    ];

    return merged;
  }
}
