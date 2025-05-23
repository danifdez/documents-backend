import { Document } from 'mongoose';

export interface ResourceType extends Document {
  readonly abbreviation: string;
  readonly name: string;
  readonly description?: string;
  readonly example?: string;
}
