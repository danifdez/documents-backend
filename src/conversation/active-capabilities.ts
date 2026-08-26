import { EntityManager } from 'typeorm';
import {
  AGENT_DELEGATE_TOOL_NAME,
  AGENT_DELEGATE_TOOL_VERSION,
  BROWSER_READ_TOOL_CAPABILITY,
  BROWSER_READ_TOOL_NAME,
  BROWSER_READ_TOOL_VERSION,
  DOCUMENT_SEARCH_TOOL_NAME,
  DOCUMENT_SEARCH_TOOL_VERSION,
  SKILL_RESOURCE_LOAD_TOOL_NAME,
  SKILL_RESOURCE_LOAD_TOOL_VERSION,
  USER_TASK_CREATE_TOOL_NAME,
  USER_TASK_CREATE_TOOL_VERSION,
  WORKSPACE_FILE_DELETE_TOOL_NAME,
  WORKSPACE_FILE_DELETE_TOOL_VERSION,
  WORKSPACE_FILE_LIST_TOOL_NAME,
  WORKSPACE_FILE_LIST_TOOL_VERSION,
  WORKSPACE_FILE_READ_TOOL_NAME,
  WORKSPACE_FILE_READ_TOOL_VERSION,
  WORKSPACE_FILE_SEARCH_TOOL_NAME,
  WORKSPACE_FILE_SEARCH_TOOL_VERSION,
  WORKSPACE_FILE_WRITE_TOOL_NAME,
  WORKSPACE_FILE_WRITE_TOOL_VERSION,
} from '../execution/execution-tool.constants';
import { WorkerEntity } from '../worker/worker.entity';
import { WorkerKind } from '../worker/worker-kind.enum';
import type { ConversationOwnerType } from './conversation-session.entity';
import {
  ActiveProductSkill,
  selectProductSkills,
} from './product-skill-registry';

export const ACTIVE_CAPABILITY_SET_SCHEMA = 'active-capability-set/1';
const BROWSER_HEARTBEAT_MAX_AGE_MS = 60_000;

type AvailabilityBasis =
  | 'core_read'
  | 'core_confirmed_effect'
  | 'bounded_delegation'
  | 'configured_folder'
  | 'paired_browser';

interface ActiveToolCapability {
  name: string;
  descriptorVersion: string;
  availabilityBasis: AvailabilityBasis;
}

export interface ActiveCapabilitySet {
  schemaVersion: typeof ACTIVE_CAPABILITY_SET_SCHEMA;
  owner: { type: ConversationOwnerType; id: number };
  selectionPolicy: 'backend-availability/1';
  tools: ActiveToolCapability[];
  skills: ActiveProductSkill[];
}

export async function buildActiveCapabilitySet(
  manager: EntityManager,
  input: {
    ownerType: ConversationOwnerType;
    ownerId: number;
    ownerPrincipal: string;
    folderScope: string | null;
    browserFederationEnabled: boolean;
    objective: string;
  },
): Promise<ActiveCapabilitySet> {
  const tools: ActiveToolCapability[] = [
    tool(DOCUMENT_SEARCH_TOOL_NAME, DOCUMENT_SEARCH_TOOL_VERSION, 'core_read'),
    tool(
      SKILL_RESOURCE_LOAD_TOOL_NAME,
      SKILL_RESOURCE_LOAD_TOOL_VERSION,
      'core_read',
    ),
    tool(
      USER_TASK_CREATE_TOOL_NAME,
      USER_TASK_CREATE_TOOL_VERSION,
      'core_confirmed_effect',
    ),
    tool(
      AGENT_DELEGATE_TOOL_NAME,
      AGENT_DELEGATE_TOOL_VERSION,
      'bounded_delegation',
    ),
  ];
  if (input.folderScope) {
    tools.push(
      tool(
        WORKSPACE_FILE_LIST_TOOL_NAME,
        WORKSPACE_FILE_LIST_TOOL_VERSION,
        'configured_folder',
      ),
      tool(
        WORKSPACE_FILE_SEARCH_TOOL_NAME,
        WORKSPACE_FILE_SEARCH_TOOL_VERSION,
        'configured_folder',
      ),
      tool(
        WORKSPACE_FILE_READ_TOOL_NAME,
        WORKSPACE_FILE_READ_TOOL_VERSION,
        'configured_folder',
      ),
      tool(
        WORKSPACE_FILE_WRITE_TOOL_NAME,
        WORKSPACE_FILE_WRITE_TOOL_VERSION,
        'configured_folder',
      ),
      tool(
        WORKSPACE_FILE_DELETE_TOOL_NAME,
        WORKSPACE_FILE_DELETE_TOOL_VERSION,
        'configured_folder',
      ),
    );
  }
  if (
    input.browserFederationEnabled &&
    (await hasPairedBrowser(manager, input.ownerPrincipal))
  ) {
    tools.push(
      tool(BROWSER_READ_TOOL_NAME, BROWSER_READ_TOOL_VERSION, 'paired_browser'),
    );
  }
  return {
    schemaVersion: ACTIVE_CAPABILITY_SET_SCHEMA,
    owner: { type: input.ownerType, id: input.ownerId },
    selectionPolicy: 'backend-availability/1',
    tools,
    skills: selectProductSkills(
      input.objective,
      new Set(tools.map(({ name }) => name)),
    ),
  };
}

function tool(
  name: string,
  descriptorVersion: string,
  availabilityBasis: AvailabilityBasis,
): ActiveToolCapability {
  return { name, descriptorVersion, availabilityBasis };
}

async function hasPairedBrowser(
  manager: EntityManager,
  ownerPrincipal: string,
): Promise<boolean> {
  return manager
    .getRepository(WorkerEntity)
    .createQueryBuilder('worker')
    .where('worker.workerKind = :workerKind', {
      workerKind: WorkerKind.BROWSER,
    })
    .andWhere('worker.ownerPrincipal = :ownerPrincipal', { ownerPrincipal })
    .andWhere("worker.status = 'online'")
    .andWhere('worker.revokedAt IS NULL')
    .andWhere('worker.lastHeartbeat > :threshold', {
      threshold: new Date(Date.now() - BROWSER_HEARTBEAT_MAX_AGE_MS),
    })
    .andWhere('worker.capabilities @> :capabilities::jsonb', {
      capabilities: JSON.stringify([BROWSER_READ_TOOL_CAPABILITY]),
    })
    .getExists();
}
