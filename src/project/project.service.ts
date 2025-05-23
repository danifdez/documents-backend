import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { Project } from './project.interface';

@Injectable()
export class ProjectService {
  constructor(
    @Inject('PROJECT_MODEL')
    private projectModel: Model<Project>,
  ) { }

  async findOne(id: string): Promise<Project> {
    return this.projectModel.findOne({ _id: id }).exec();
  }

  async create(project: Project): Promise<Project> {
    const createdProject = new this.projectModel(project);
    return createdProject.save();
  }

  async findAll(): Promise<Project[]> {
    return this.projectModel.find().exec();
  }

  async search(query: string): Promise<Project[]> {
    if (!query || query.trim() === '') {
      return this.findAll();
    }

    const searchRegex = new RegExp(query, 'i');

    return this.projectModel.find({
      $or: [
        { name: searchRegex },
        { description: searchRegex }
      ]
    }).exec();
  }

  async update(id: string, project: Partial<Project>): Promise<Project> {
    return this.projectModel
      .findByIdAndUpdate(id, project, { new: true })
      .exec();
  }

  async remove(id: string): Promise<void> {
    await this.projectModel.findByIdAndDelete(id).exec();
  }
}
