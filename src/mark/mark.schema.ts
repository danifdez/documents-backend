import * as mongoose from 'mongoose';

export const MarkSchema = new mongoose.Schema(
  {
    doc: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doc',
      required: true,
    },
    content: String,
  },
  { timestamps: true },
);
