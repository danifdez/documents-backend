import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { Doc } from './doc.interface';
import { ObjectId } from 'mongodb';

@Injectable()
export class DocService {
  constructor(
    @Inject('DOCUMENT_MODEL')
    private docModel: Model<Doc>,
  ) { }

  async findOne(id: string): Promise<Doc> {
    return this.docModel.findOne({ _id: id }).exec();
  }

  async create(doc: Doc): Promise<Doc> {
    const createdDoc = new this.docModel(doc);
    return createdDoc.save();
  }

  async findByThread(threadId: string): Promise<Doc[]> {
    return this.docModel.find({ thread: new ObjectId(threadId) }).exec();
  }

  async findByProject(projectId: string): Promise<Doc[]> {
    return this.docModel
      .aggregate([
        {
          $lookup: {
            from: 'threads',
            localField: 'thread',
            foreignField: '_id',
            as: 'threadData',
          },
        },
        {
          $match: {
            $or: [
              { 'threadData.project': new ObjectId(projectId) },
              {
                project: new ObjectId(projectId),
                thread: { $exists: false },
              },
              {
                project: new ObjectId(projectId),
                thread: null,
              },
            ],
          },
        },
        {
          $project: {
            name: 1,
            thread: 1,
            project: 1,
            content: 1,
          },
        },
        {
          $sort: { _id: -1 },
        },
        {
          $limit: 10,
        },
      ])
      .exec();
  }

  async update(id: string, docData: Partial<Doc>): Promise<Doc> {
    return this.docModel.findByIdAndUpdate(id, docData, { new: true }).exec();
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const result = await this.docModel.deleteOne({ _id: id }).exec();
    return { deleted: result.deletedCount > 0 };
  }
}
