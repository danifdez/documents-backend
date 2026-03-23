## Architecture

The Documents Backend is built with NestJS 10 and TypeScript. It follows NestJS module conventions:
each feature area is encapsulated in its own module with a controller, service, and entity. All modules
are wired together in `AppModule`.

### Technology stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 10 (TypeScript) |
| Database | PostgreSQL 17.6 via TypeORM 0.3 |
| Real-time | Socket.io (WebSocket gateway) |
| Auth | Passport.js + JWT |
| File uploads | Multer |
| Scheduling | `@nestjs/schedule` (cron-based) |
| Rate limiting | `@nestjs/throttler` (100 req / 60s globally) |
| Security | Helmet middleware |

### Module map

The following modules make up the backend. Each maps to a directory under `src/`.

#### Core infrastructure

| Module | Purpose |
|--------|---------|
| `DatabaseModule` | Configures and provides the TypeORM `DataSource` used by all repositories |
| `AuthModule` | JWT authentication, user management, and access control guards |
| `JobModule` | CRUD over the `jobs` table; job creation and status tracking |
| `JobProcessorModule` | Auto-discovers and registers all job processors; provides `JobProcessorFactory` |
| `TaskScheduleModule` | Cron scheduler that polls for pending jobs and dispatches them |
| `FileStorageModule` | SHA256 content-addressed file storage on disk (see [File Storage](./file-storage.md)) |
| `NotificationModule` | Socket.io WebSocket gateway that pushes events to connected clients |
| `WorkerModule` | Tracks worker instances, their capabilities, and heartbeat status |

#### Document and resource management

| Module | Purpose |
|--------|---------|
| `ResourceModule` | Core document management: upload, metadata, status, content, download |
| `ResourceTypeModule` | Reference data for resource types (51 types seeded from CSV) |
| `DocModule` | Rich text documents (composed notes, reports) linked to resources or threads |
| `MarkModule` | Highlighted/marked passages within documents or docs |
| `CommentModule` | Inline comments on documents or docs |
| `ExportModule` | Export resources and their processed content to archive files |

#### AI and analysis

| Module | Purpose |
|--------|---------|
| `ModelModule` | Proxy to the models service for triggering AI tasks and retrieving results |
| `EntityModule` | Confirmed named entities (people, organizations, locations, etc.) |
| `EntityTypeModule` | Reference data for entity types (11 NER categories) |
| `PendingEntityModule` | Unconfirmed NER candidates awaiting user review |
| `AuthorModule` | Document authors extracted and linked across resources |
| `SearchModule` | Full-text search across resources, marks, references, and the knowledge base |

#### Project and workspace

| Module | Purpose |
|--------|---------|
| `ProjectModule` | Top-level container; all content belongs to a project |
| `ThreadModule` | Workspaces within a project for organizing discussions and documents |
| `CanvasModule` | Visual boards (free-form canvas with JSON data) per project or thread |
| `NoteModule` | Free-form text notes attached to a project |
| `CalendarEventModule` | Calendar events with start/end dates, colors, and all-day support |
| `TimelineModule` | Ordered event timelines stored as structured JSON |
| `UserTaskModule` | Simple task lists (pending / completed) per project |
| `KnowledgeBaseModule` | Manually curated knowledge entries with tags |
| `BibliographyModule` | Bibliographic references (BibTeX-compatible) linked to resources |
| `DatasetModule` | Structured data import (CSV), record storage, statistics, and querying |
| `ReferenceModule` | Cross-references between resources |

#### Auth and offline

| Module | Purpose |
|--------|---------|
| `OfflineModule` | Endpoints for syncing content and generating offline bundles |

### Database schema overview

The database is managed entirely through TypeORM migrations. The schema is split into these main areas:

**Projects and workspaces**
- `projects` — top-level containers
- `threads` — nested workspaces within a project
- `canvases` — visual boards
- `notes` — free-form notes
- `calendar_events` — timestamped events
- `timelines` — ordered event sequences
- `user_tasks` — to-do items

**Documents and content**
- `resources` — uploaded files with extracted content, summary, keywords, language, status
- `resource_types` — reference table of 51 document categories
- `docs` — composed text documents
- `marks` — highlighted passages
- `comments` — inline comments
- `bibliography_entries` — full bibliographic records

**People and entities**
- `authors` — document authors
- `resource_authors` — M2M join between resources and authors
- `entities` — confirmed named entities with translations and aliases
- `entity_types` — 11 NER categories (PERSON, ORGANIZATION, LOCATION, etc.)
- `entity_projects` — M2M join between entities and projects
- `resource_entities` — M2M join between entities and resources
- `pending_entities` — unconfirmed NER candidates

**AI and search**
- `jobs` — async job queue
- `workers` — registered worker instances
- `knowledge_entries` — manually curated knowledge base entries

**Data**
- `datasets` — imported structured data files
- `dataset_records` — individual rows with typed values
- `dataset_relations` — links between datasets
- `dataset_record_links` — cross-dataset record relationships

### Request flow

A typical REST request follows this path:

```
HTTP request
  → Helmet (security headers)
  → ThrottlerGuard (rate limit: 100 req / 60s)
  → ConditionalAuthGuard (verify JWT if AUTH_ENABLED=true)
  → PermissionsGuard (check fine-grained permissions)
  → Controller method
  → Service layer (business logic + TypeORM)
  → PostgreSQL
  → JSON response
```

For file uploads, Multer parses the multipart body before the controller method runs.

For real-time events, the `NotificationGateway` pushes Socket.io events directly to connected clients
at any point during request or job processing.

### Interaction with the models service

The backend never runs AI models itself. All AI tasks are delegated to the separate models service
(a Python worker) via HTTP. The flow is:

1. Backend creates a job record in PostgreSQL with the task type and input payload.
2. The `TaskScheduleService` picks up the job and calls the models service HTTP endpoint.
3. The models service processes the request and returns results.
4. The processor stores the results in the database and updates resource state.
5. A WebSocket notification is emitted to the frontend.
