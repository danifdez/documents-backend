import * as mongoose from 'mongoose';

export const ThreadSchema = new mongoose.Schema({
  name: String,
  description: {
    type: String,
    required: false,
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
});
