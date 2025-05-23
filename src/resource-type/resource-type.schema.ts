import * as mongoose from 'mongoose';

export const ResourceTypeSchema = new mongoose.Schema({
  abbreviation: { type: String, required: true },
  name: { type: String, required: true },
  description: { tyepe: String },
  example: { type: String },
});
