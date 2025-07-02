export interface JobRequest extends Document {
  readonly type: string;
  readonly content: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly resourceId: string;
}
