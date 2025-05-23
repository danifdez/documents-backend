import { Document, ObjectId } from 'mongoose';

export interface Thread extends Document {
  readonly name: string;
  readonly description?: string;
  readonly project: ObjectId;
  readonly parent?: ObjectId;
}
