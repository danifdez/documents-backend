import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { Thread } from './thread.interface';

@Injectable()
export class ThreadService {
  constructor(
    @Inject('THREAD_MODEL')
    private threadModel: Model<Thread>,
  ) { }

  async findOne(id: string): Promise<Thread> {
    return this.threadModel.findOne({ _id: id }).exec();
  }

  async create(project: Thread): Promise<Thread> {
    const createdCat = new this.threadModel(project);
    return createdCat.save();
  }

  async findByProject(projectId: string): Promise<Thread[]> {
    return this.threadModel.find({ project: projectId }).exec();
  }
}
