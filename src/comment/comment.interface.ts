import { Document, ObjectId } from 'mongoose';

export interface Comment extends Document {
  readonly doc: ObjectId;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
