import { Document, ObjectId } from 'mongoose';

export interface Resource extends Document {
  readonly project: ObjectId;
  readonly name: string;
  readonly hash: string;
  readonly relatedTo?: ObjectId;
  readonly type?: ObjectId;
  readonly mimeType: string;
  readonly originalName: string;
  readonly uploadDate: Date;
  readonly fileSize: number;
  readonly path: string;
  readonly url?: string;
  readonly title?: string;
  readonly publicationDate?: Date;
  readonly author?: string;
  readonly content?: string;
  readonly translatedContent?: string;
  readonly workingContent?: string;
  readonly language?: string;
  readonly entities?: Array<{
    word: string;
    entity: string;
  }>;
}
