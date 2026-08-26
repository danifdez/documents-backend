import { canonicalHash } from '../execution/execution-canonical';

export const WORKSPACE_DOCUMENT_SKILL_ID = 'workspace-document-workflow';
export const WORKSPACE_DOCUMENT_SKILL_VERSION = 'workspace-document-workflow/1';

export const WORKSPACE_DOCUMENT_SKILL_INSTRUCTIONS = [
  'Use the configured workspace folder as an optional source of context and ' +
    'as the place where requested file changes are applied.',
  '',
  'Discover before acting: list files when the relevant path is unknown, ' +
    'search indexed content to locate evidence, and read concrete files ' +
    'before modifying them. Preserve the existing format and unrelated ' +
    'content when editing. A document may be text or binary; use UTF-8 ' +
    'content for text formats and base64 bytes for binary formats.',
  '',
  "Writing or deleting is allowed only when the user's explicit request " +
    'requires that effect. A skill never grants a tool, permission, ' +
    'confirmation, path, or broader data access. If a required workspace ' +
    'tool is absent, explain the limitation instead of inventing an effect.',
].join('\n');

const WORKSPACE_OBJECTIVE_TERMS = new Set([
  'file',
  'files',
  'folder',
  'folders',
  'directory',
  'directories',
  'document',
  'documents',
  'archivo',
  'archivos',
  'carpeta',
  'carpetas',
  'directorio',
  'directorios',
  'documento',
  'documentos',
  'fichero',
  'ficheros',
]);

export interface ProductSkillDefinition {
  skillId: string;
  version: string;
  title: string;
  description: string;
  requiredCapabilities: string[];
  resourceManifest: [];
  dataPolicy: 'preserve_source_policy';
  effectPolicy: 'explicit_user_intent';
  instructions: string;
  contentHash: string;
  isApplicable: (objective: string) => boolean;
}

export interface ActiveProductSkill {
  skillId: string;
  version: string;
  title: string;
  description: string;
  contentHash: string;
  activationReason: 'objective_match';
}

export const PRODUCT_SKILL_REGISTRY: readonly ProductSkillDefinition[] = [
  {
    skillId: WORKSPACE_DOCUMENT_SKILL_ID,
    version: WORKSPACE_DOCUMENT_SKILL_VERSION,
    title: 'Workspace document workflow',
    description:
      'Discover, inspect, create, edit, or remove documents in the optional workspace folder.',
    requiredCapabilities: [
      'workspace_files.list',
      'workspace_files.search',
      'workspace_files.read',
      'workspace_files.write',
      'workspace_files.delete',
    ],
    resourceManifest: [],
    dataPolicy: 'preserve_source_policy',
    effectPolicy: 'explicit_user_intent',
    instructions: WORKSPACE_DOCUMENT_SKILL_INSTRUCTIONS,
    contentHash: canonicalHash(WORKSPACE_DOCUMENT_SKILL_INSTRUCTIONS),
    isApplicable: (objective) =>
      objective
        .toLocaleLowerCase('en')
        .split(/[^\p{L}\p{N}_-]+/u)
        .some((term) => WORKSPACE_OBJECTIVE_TERMS.has(term)),
  },
];

export function selectProductSkills(
  objective: string,
  availableCapabilities: ReadonlySet<string>,
): ActiveProductSkill[] {
  return PRODUCT_SKILL_REGISTRY.filter(
    (skill) =>
      skill.isApplicable(objective) &&
      skill.requiredCapabilities.every((capability) =>
        availableCapabilities.has(capability),
      ),
  ).map(({ skillId, version, title, description, contentHash }) => ({
    skillId,
    version,
    title,
    description,
    contentHash,
    activationReason: 'objective_match',
  }));
}
