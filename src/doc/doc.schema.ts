import * as mongoose from 'mongoose';

export const DocSchema = new mongoose.Schema({
  name: String,
  thread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread',
    required: false,
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
  },
  content: String,
});
