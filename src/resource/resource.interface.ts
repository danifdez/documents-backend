import { Document, ObjectId } from 'mongoose';

export interface Resource extends Document {
  readonly project: ObjectId;
  readonly name: string;
  readonly hash: string;
  readonly description?: string;
  readonly type?: ObjectId;
  readonly mimeType: string;
  readonly originalName: string;
  readonly uploadDate: Date;
  readonly fileSize: number;
  readonly source: string;
  readonly path: string;
  readonly content?: string;
  readonly translatedContent?: string;
  readonly workingContent?: string;
  readonly language?: string;
  readonly entities?: Array<{
    word: string;
    entity: string;
  }>;
  readonly metadata: object;
}
