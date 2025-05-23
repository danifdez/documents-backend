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

  async update(id: string, docData: Partial<Doc>): Promise<Doc> {
    return this.docModel.findByIdAndUpdate(id, docData, { new: true }).exec();
  }
}
