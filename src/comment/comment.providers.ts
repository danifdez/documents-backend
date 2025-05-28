import { Connection } from 'mongoose';
import { CommentSchema } from './comment.schema';

export const commentProviders = [
  {
    provide: 'COMMENT_MODEL',
    useFactory: (connection: Connection) => connection.model('Comment', CommentSchema),
    inject: ['DATABASE_CONNECTION'],
  },
];
