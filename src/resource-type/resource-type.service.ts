import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { ResourceType } from './resource-type.interface';
import { ObjectId } from 'mongodb';

@Injectable()
export class ResourceTypeService {
  constructor(
    @Inject('RESOURCE_TYPE_MODEL')
    private resourceTypeModel: Model<ResourceType>,
  ) { }

  async findOne(id: string): Promise<ResourceType> {
    return this.resourceTypeModel.findOne({ _id: id }).exec();
  }

  async create(resource: ResourceType): Promise<ResourceType> {
    const createdResource = new this.resourceTypeModel(resource);
    return createdResource.save();
  }

  async findByProject(projectId: string): Promise<ResourceType[]> {
    return this.resourceTypeModel
      .find({ project: new ObjectId(projectId) }, { name: 1, type: 1 })
      .sort({ _id: -1 })
      .limit(10)
      .exec();
  }

  async update(
    id: string,
    resource: Partial<ResourceType>,
  ): Promise<ResourceType> {
    return this.resourceTypeModel
      .findByIdAndUpdate(id, resource, { new: true })
      .exec();
  }

  async remove(id: string): Promise<void> {
    await this.resourceTypeModel.findByIdAndDelete(id).exec();
  }

  async findAll(): Promise<ResourceType[]> {
    return this.resourceTypeModel.find().exec();
  }
}
