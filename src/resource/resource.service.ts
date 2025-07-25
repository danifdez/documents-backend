import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { Resource } from './resource.interface';
import { ObjectId } from 'mongodb';

@Injectable()
export class ResourceService {
  constructor(
    @Inject('RESOURCE_MODEL')
    private resourceModel: Model<Resource>,
  ) { }

  async findOne(id: string): Promise<Resource> {
    return this.resourceModel.findOne({ _id: id }).populate('type').exec();
  }

  async create(resource: Partial<Resource>): Promise<Resource> {
    const createdResource = new this.resourceModel(resource);
    return createdResource.save();
  }

  async findByProject(projectId: string): Promise<Resource[]> {
    return this.resourceModel
      .find(
        { project: new ObjectId(projectId) },
        { name: 1, type: 1, mimeType: 1 },
      )
      .populate('type', 'abbreviation')
      .sort({ _id: -1 })
      .limit(10)
      .exec();
  }

  async search(query: string): Promise<Resource[]> {
    if (!query || !query.trim()) return [];

    return this.resourceModel
      .find({ name: { $regex: query, $options: 'i' } })
      .sort({ _id: -1 })
      .limit(10)
      .exec();
  }

  async findByHash(hash: string): Promise<Resource | null> {
    return this.resourceModel.findOne({ hash }).exec();
  }

  async update(id: string, resource: Partial<Resource>): Promise<Resource> {
    return this.resourceModel
      .findByIdAndUpdate(id, resource, { new: true })
      .exec();
  }

  async remove(id: string): Promise<Resource | null> {
    const resource = await this.resourceModel.findById(id).exec();
    if (!resource) return null;
    await this.resourceModel.findByIdAndDelete(id).exec();
    return resource;
  }

  async globalSearch(searchTerm: string): Promise<any[]> {
    const commonQueryOptions = {
      $text: { $search: searchTerm },
    };

    return this.resourceModel
      .find(commonQueryOptions, {
        score: { $meta: 'textScore' },
        title: 1,
        name: 1,
        content: 1,
      })
      .sort({ score: { $meta: 'textScore' } })
      .limit(50)
      .lean()
      .exec();
  }
}
