import { Document, ObjectId } from 'mongoose';

export interface Doc extends Document {
  readonly name: string;
  readonly thread?: ObjectId;
  readonly project: ObjectId;
  readonly content?: string;
}
