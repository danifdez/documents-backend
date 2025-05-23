import * as mongoose from 'mongoose';

export const DocSchema = new mongoose.Schema({
  name: String,
  thread: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Thread',
    required: true,
  },
  content: String,
});
