import * as mongoose from 'mongoose';

export const ResourceSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  name: { type: String, required: true },
  hash: { type: String, required: true, unique: true },
  description: String,
  type: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResourceType',
    required: false,
  },
  mimeType: { type: String, required: true },
  originalName: { type: String, required: true },
  uploadDate: { type: Date, required: true },
  fileSize: { type: Number, required: true },
  source: { type: String, required: true },
  path: { type: String, required: true },
  content: { type: String },
  translatedContent: { type: String },
  workingContent: { type: String },
  language: { type: String },
  entities: { type: Array },
  metadata: { type: Object },
});
