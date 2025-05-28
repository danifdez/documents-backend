import { Model } from 'mongoose';
import { Injectable, Inject } from '@nestjs/common';
import { Comment } from './comment.interface';
import { ObjectId } from 'mongodb';

@Injectable()
export class CommentService {
  constructor(
    @Inject('COMMENT_MODEL')
    private commentModel: Model<Comment>,
  ) { }

  async findOne(id: string): Promise<Comment> {
    return this.commentModel.findOne({ _id: id }).exec();
  }

  async create(comment: Comment): Promise<Comment> {
    const createdComment = new this.commentModel(comment);
    return createdComment.save();
  }

  async findByDoc(docId: string): Promise<Comment[]> {
    return this.commentModel.find({ doc: new ObjectId(docId) }).exec();
  }

  async update(id: string, commentData: Partial<Comment>): Promise<Comment> {
    return this.commentModel
      .findByIdAndUpdate(id, commentData, { new: true })
      .exec();
  }

  async delete(id: string): Promise<void> {
    await this.commentModel.findByIdAndDelete(id).exec();
  }
}
