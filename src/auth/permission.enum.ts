export enum Permission {
  // AI / Model features
  ASK = 'ask',
  SUMMARIZE = 'summarize',
  TRANSLATE = 'translate',
  ENTITY_EXTRACTION = 'entity-extraction',
  KEY_POINTS = 'key-points',
  KEYWORDS = 'keywords',

  // Core data management
  PROJECTS = 'projects',
  DOCUMENTS = 'documents',
  UPLOAD = 'upload',
  EXPORT = 'export',
  WRITE = 'write',
  DELETE = 'delete',

  // Feature-specific
  CANVAS = 'canvas',
  DATASETS = 'datasets',
  TIMELINES = 'timelines',
  KNOWLEDGE_BASE = 'knowledge-base',
  BIBLIOGRAPHY = 'bibliography',
  RELATIONSHIPS = 'relationships',
  USER_MANAGEMENT = 'user-management',
}
