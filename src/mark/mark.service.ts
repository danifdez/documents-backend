import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { Mark } from './mark.interface';
import { ObjectId } from 'mongodb';

@Injectable()
export class MarkService {
  constructor(
    @Inject('MARK_MODEL')
    private markModel: Model<Mark>,
  ) { }

  async findOne(id: string): Promise<Mark> {
    return this.markModel.findOne({ _id: id }).exec();
  }

  async create(mark: Mark): Promise<Mark> {
    const createdMark = new this.markModel(mark);
    return createdMark.save();
  }

  async findByDoc(docId: string): Promise<Mark[]> {
    return this.markModel.find({ doc: new ObjectId(docId) }).exec();
  }

  async search(query: string): Promise<Mark[]> {
    if (!query || !query.trim()) return [];
    return this.markModel
      .find({ content: { $regex: query, $options: 'i' } })
      .sort({ createdAt: -1 })
      .limit(10)
      .exec();
  }

  async update(id: string, markData: Partial<Mark>): Promise<Mark> {
    return this.markModel.findByIdAndUpdate(id, markData, { new: true }).exec();
  }

  async delete(id: string): Promise<void> {
    await this.markModel.findByIdAndDelete(id).exec();
  }
}
