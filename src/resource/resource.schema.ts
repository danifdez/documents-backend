import * as mongoose from 'mongoose';

export const ResourceSchema = new mongoose.Schema({
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  name: { type: String, required: true },
  hash: { type: String, required: true, unique: true },
  relatedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Resource',
    required: false,
  },
  type: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ResourceType',
    required: false,
  },
  mimeType: { type: String, required: true },
  originalName: { type: String, required: true },
  uploadDate: { type: Date, required: true },
  fileSize: { type: Number, required: true },
  path: { type: String, required: true },
  url: { type: String, required: false },
  title: { type: String, required: false },
  author: { type: String, required: false },
  publicationDate: { type: Date, required: false },
  content: { type: String },
  translatedContent: { type: String },
  workingContent: { type: String },
  summary: { type: String },
  language: { type: String },
  entities: { type: Array },
});
