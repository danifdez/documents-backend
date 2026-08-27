import type { ActiveCapabilitySet } from '../conversation/active-capabilities';
import type {
  ActiveConversationContext,
  ContinuityCapsule,
  ConversationRevisionPointer,
} from '../conversation/conversation-context';
import type { ActiveMemoryContext } from '../memory/active-memory';
import type {
  DatasetAnalysisParamsByTaskType,
  DatasetAnalysisTaskType,
} from '../dataset/dataset-analysis.types';
import type { GraphRelationship } from '../graph/age-graph.service';
import type {
  AgentInferenceCoordination,
  RuntimeDirective,
} from '../execution-coordinator/execution-next-work.types';
import type {
  ToolInvocationContract,
  ToolPlanContract,
  ToolResultContract,
} from './execution-tool.types';

interface FinalizerIdentity {
  originFinalizerKey?: string;
}

export interface AskExecutionPayload extends FinalizerIdentity {
  question: string;
  projectId?: number;
  requestId?: string;
  context?: string;
  graphContext: GraphRelationship[];
}

export interface BrowserInferenceExecutionPayload extends FinalizerIdentity {
  requestJson: string;
  label?: string;
  detail?: string;
}

export interface SummarizeExecutionPayload extends FinalizerIdentity {
  sourceLanguage?: string;
  targetLanguage: string;
  resourceId?: number;
  targetDocId?: number;
  type: string;
}

export interface SummarizeMapPayload extends FinalizerIdentity {
  content: string;
  chunkIndex: number;
  targetLanguage: string;
  sourceLanguage?: string;
}

export interface SummarizeReducePayload extends FinalizerIdentity {
  targetLanguage: string;
  sourceLanguage?: string;
  partials?: unknown[];
}

export type TranslateExecutionPayload = FinalizerIdentity &
  (
    | {
        resourceId: number;
        sourceLanguage: string;
        targetLanguage: string;
        sourceContentHash: string;
      }
    | {
        resourceId: number;
        targetLanguages: string[];
        translationType: 'entity-retranslate';
        entityId: number;
      }
  );

export interface TranslationUnitPayload {
  itemIndex: number;
  pieceIndex: number;
  text: string;
  originalText: string;
  path?: string;
}

export interface TranslateMapPayload extends FinalizerIdentity {
  sourceLanguage: string;
  targetLanguage: string;
  batchIndex: number;
  units: TranslationUnitPayload[];
}

export interface TranslateReducePayload extends FinalizerIdentity {
  final: boolean;
  level: number;
  groupIndex: number;
  responseMode?: 'items' | 'targets';
  itemCount?: number;
  targetLanguages?: string[];
  partials?: unknown[];
}

export interface EntityExtractionExecutionPayload extends FinalizerIdentity {
  resourceId: number;
  sourceContentHash: string;
  sourceLanguage: string;
}

export interface EntityExtractionMapPayload extends FinalizerIdentity {
  content: string;
  chunkIndex: number;
}

export interface EntityExtractionReducePayload extends FinalizerIdentity {
  partials?: unknown[];
}

export interface KeyPointExecutionPayload extends FinalizerIdentity {
  resourceId: number;
  targetLanguage: string;
}

export interface KeyPointMapPayload extends FinalizerIdentity {
  content: string;
  chunkIndex: number;
  targetLanguage: string;
}

export interface KeyPointReducePayload extends FinalizerIdentity {
  targetLanguage: string;
  partials?: unknown[];
}

export interface KeywordsExecutionPayload extends FinalizerIdentity {
  resourceId: number;
  targetLanguage: string;
}

export interface KeywordsMapPayload extends FinalizerIdentity {
  content: string;
  chunkIndex: number;
  targetLanguage: string;
}

export interface KeywordsReducePayload extends FinalizerIdentity {
  final: boolean;
  inputKind: 'candidates' | 'statistics';
  leafStartIndex?: number;
  partials?: unknown[];
}

export interface DateExtractionExecutionPayload extends FinalizerIdentity {
  resourceId: number;
  sourceContentHash?: string;
  detectedLanguage?: string;
  anchorDate?: string | null;
}

export interface DateExtractionMapPayload extends FinalizerIdentity {
  content: string;
  chunkIndex: number;
  charOffset: number;
  language: string | null;
  anchorDate: string | null;
}

export interface DateExtractionReducePayload extends FinalizerIdentity {
  partials?: unknown[];
}

export interface RelationshipPayloadEntity {
  id: number;
  name: string;
  type: string;
}

export interface RelationshipExtractionExecutionPayload extends FinalizerIdentity {
  resourceId: number;
  projectId: number | null;
  entities: RelationshipPayloadEntity[];
}

export interface RelationshipExtractionMapPayload extends FinalizerIdentity {
  content: string;
  chunkIndex: number;
  entities: RelationshipPayloadEntity[];
}

export interface RelationshipExtractionReducePayload extends FinalizerIdentity {
  partials?: unknown[];
}

export interface SearchExecutionPayload extends FinalizerIdentity {
  query: string;
  projectId?: number;
  requestId?: string;
  limit: number;
  score_threshold?: number;
}

export type IngestContentExecutionPayload = FinalizerIdentity &
  (
    | {
        sourceType?: 'resource';
        resourceId: number;
        projectId: number | null;
        content: string;
      }
    | {
        sourceType: 'doc';
        docId: number;
        projectId?: number;
        content: string;
      }
    | {
        sourceType: 'knowledge';
        knowledgeEntryId: number;
        content: string;
      }
  );

export interface DocumentExtractionExecutionPayload extends FinalizerIdentity {
  hash: string;
  extension: string;
  resourceId: number;
}

export interface TranscribeExecutionPayload extends FinalizerIdentity {
  hash: string;
  extension: string;
  resourceId: number;
}

export interface DetectLanguageExecutionPayload extends FinalizerIdentity {
  resourceId: number;
  samples: string[];
}

export interface IndexedFileExtractionPayload extends FinalizerIdentity {
  indexedFileId: number;
  extension: string;
  checksum: string;
}

export interface IndexedFileIngestPayload extends FinalizerIdentity {
  indexedFileId: number;
  ownerType: 'assistant' | 'agent';
  ownerId: number;
  content: string;
  filename: string;
  checksum: string;
}

export interface IndexedFileSearchPayload extends FinalizerIdentity {
  ownerType: 'assistant' | 'agent';
  ownerId: number;
  query: string;
  limit: number;
  score_threshold?: number;
}

export interface DataSourceSyncExecutionPayload extends FinalizerIdentity {
  dataSourceId: number;
}

export interface DatasetFieldPayload {
  key: string;
  name: string;
  description?: string;
  type: 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'select';
  required: boolean;
  options?: string[];
  linkedDatasetId?: number;
  linkedLookupField?: string;
  linkedDisplayField?: string;
}

export interface DatasetExtractRowPayload extends FinalizerIdentity {
  datasetId: number;
  recordId: number;
  resourceId: number;
  projectId: number | null;
  schema: DatasetFieldPayload[];
  columnsToExtract: string[];
  documentText: string;
  sourceTitle: string;
  isAudio: boolean;
  model: string;
}

export interface DatasetProposeColumnsPayload extends FinalizerIdentity {
  projectId: number | null;
  resources: Array<{ id: number; title: string; excerpt: string }>;
}

export type DatasetAnalysisExecutionPayload<
  TTaskType extends DatasetAnalysisTaskType,
> = FinalizerIdentity & {
  params: DatasetAnalysisParamsByTaskType[TTaskType];
} & (TTaskType extends 'query'
    ? { datasetId?: number; datasetIds?: number[] }
    : { datasetId: number });

export interface ActiveInputReductionPayload {
  schemaVersion: 'active-input-reduction/1';
  sourceArtifact: { artifactId: string; contentHash: string; size: number };
  planArtifact: { artifactId: string; contentHash: string };
  strategy: 'chunk-map-reduce/1';
  chunkCount: number;
  digest: string;
}

export interface ChatToolRound {
  round: number;
  calls: Array<{
    toolCallId: string;
    name: string;
    arguments: ToolInvocationContract['arguments'];
  }>;
  results: ToolResultContract[];
}

export interface ChatExecutionPayload extends FinalizerIdentity {
  ownerId?: number;
  folderScope?: string | null;
  systemPrompt?: string | null;
  conversation?: ActiveConversationContext['conversation'];
  conversationContext?: ConversationRevisionPointer;
  continuityCapsule?: ContinuityCapsule | null;
  activeMemory?: ActiveMemoryContext | null;
  activeCapabilities?: ActiveCapabilitySet | null;
  activeInputReduction?: ActiveInputReductionPayload | null;
  toolHistory?: ChatToolRound[];
  delegationMode?: boolean;
  runtimeDirective?: RuntimeDirective;
}

export interface DelegatedAgentExecutionPayload extends FinalizerIdentity {
  goal: string;
  delegationOperationId: string;
  joinPolicy: 'all';
  depth: 1;
}

export interface ContextInputMapPayload extends FinalizerIdentity {
  planArtifactId: string;
  chunkIndex: number;
  start: number;
  end: number;
  contentHash: string;
  content: string;
}

export interface ContextInputReducePayload extends FinalizerIdentity {
  planArtifactId: string;
  level: number;
  groupIndex: number;
  partials?: unknown[];
}

interface StaticExecutionPayloadByTaskType {
  ask: AskExecutionPayload;
  'browser-inference': BrowserInferenceExecutionPayload;
  summarize: SummarizeExecutionPayload;
  'summarize-map': SummarizeMapPayload;
  'summarize-reduce': SummarizeReducePayload;
  translate: TranslateExecutionPayload;
  'translate-map': TranslateMapPayload;
  'translate-reduce': TranslateReducePayload;
  'entity-extraction': EntityExtractionExecutionPayload;
  'entity-extraction-map': EntityExtractionMapPayload;
  'entity-extraction-reduce': EntityExtractionReducePayload;
  'key-point': KeyPointExecutionPayload;
  'key-point-map': KeyPointMapPayload;
  'key-point-reduce': KeyPointReducePayload;
  keywords: KeywordsExecutionPayload;
  'keywords-map': KeywordsMapPayload;
  'keywords-reduce': KeywordsReducePayload;
  'date-extraction': DateExtractionExecutionPayload;
  'date-extraction-map': DateExtractionMapPayload;
  'date-extraction-reduce': DateExtractionReducePayload;
  'relationship-extraction': RelationshipExtractionExecutionPayload;
  'relationship-extraction-map': RelationshipExtractionMapPayload;
  'relationship-extraction-reduce': RelationshipExtractionReducePayload;
  search: SearchExecutionPayload;
  'ingest-content': IngestContentExecutionPayload;
  'document-extraction': DocumentExtractionExecutionPayload;
  transcribe: TranscribeExecutionPayload;
  'detect-language': DetectLanguageExecutionPayload;
  'indexed-file-extraction': IndexedFileExtractionPayload;
  'indexed-file-ingest': IndexedFileIngestPayload;
  'indexed-file-search': IndexedFileSearchPayload;
  'data-source-sync': DataSourceSyncExecutionPayload;
  'dataset.extract-row': DatasetExtractRowPayload;
  'dataset.propose-columns': DatasetProposeColumnsPayload;
  'assistant-chat': ChatExecutionPayload;
  'agent-chat': ChatExecutionPayload;
  'delegated-agent': DelegatedAgentExecutionPayload;
  'context-input-map': ContextInputMapPayload;
  'context-input-reduce': ContextInputReducePayload;
}

export type ExecutionPayloadByTaskType = StaticExecutionPayloadByTaskType & {
  [
    TTaskType in DatasetAnalysisTaskType
  ]: DatasetAnalysisExecutionPayload<TTaskType>;
};

export type ExecutionTaskType = keyof ExecutionPayloadByTaskType;

export type ExecutionTaskPayload<TTaskType extends ExecutionTaskType> =
  ExecutionPayloadByTaskType[TTaskType];

export type AnyExecutionTaskPayload =
  ExecutionPayloadByTaskType[ExecutionTaskType];

export function executionPayloadOwnerId(
  payload: AnyExecutionTaskPayload,
): number | undefined {
  return 'ownerId' in payload && typeof payload.ownerId === 'number'
    ? payload.ownerId
    : undefined;
}

export type ExecutionTaskWork<
  TTaskType extends ExecutionTaskType = ExecutionTaskType,
> = TTaskType extends ExecutionTaskType
  ? {
      [key: string]: unknown;
      taskType: TTaskType;
      payload: ExecutionTaskPayload<TTaskType>;
      agentName?: string;
      agentLoop?: AgentInferenceCoordination;
    }
  : never;

export interface ToolExecutionStepWork {
  [key: string]: unknown;
  taskType: string;
  toolPlan: ToolPlanContract;
  payload?: never;
}

export type ExecutionStepWork = ExecutionTaskWork | ToolExecutionStepWork;

export function executionTaskWork<TTaskType extends ExecutionTaskType>(
  taskType: TTaskType,
  payload: ExecutionTaskPayload<TTaskType>,
): ExecutionTaskWork<TTaskType> {
  return { taskType, payload } as ExecutionTaskWork<TTaskType>;
}

export type ChatCreationPayloadByKind = {
  assistant_chat: Required<
    Pick<ChatExecutionPayload, 'ownerId' | 'folderScope'>
  >;
  agent_chat: Required<
    Pick<ChatExecutionPayload, 'ownerId' | 'folderScope' | 'systemPrompt'>
  >;
};
