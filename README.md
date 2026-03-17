# Documents backend

Central API for the intelligent document processing system. Orchestrates jobs, manages resources, and delivers real-time notifications to the frontend.

## Tech Stack

- **Framework**: NestJS (TypeScript, Node.js 22)
- **Database**: PostgreSQL 17.6 with TypeORM
- **Real-time**: Socket.io (WebSocket)
- **Scheduling**: @nestjs/schedule

## Architecture

The application follows a modular NestJS architecture with 21 modules:

| Module | Purpose |
|--------|---------|
| **ProjectModule** | Project management |
| **ThreadModule** | Discussion threads |
| **DocModule** | Collaborative documents |
| **ResourceModule** | Resources (uploaded/processed files) |
| **ResourceTypeModule** | Resource type definitions |
| **FileStorageModule** | File storage (SHA256 deduplication) |
| **JobModule** | Async job system |
| **JobProcessorModule** | Job processing pipeline |
| **TaskScheduleModule** | Scheduled task execution |
| **NotificationModule** | WebSocket notifications |
| **CommentModule** | Comments on documents/resources |
| **MarkModule** | Highlights/marks on content |
| **ModelModule** | AI model interactions |
| **ReferenceModule** | References and citations |
| **SearchModule** | Global search |
| **EntityTypeModule** | Entity type definitions (PERSON, ORG, etc.) |
| **EntityModule** | Named entities |
| **AuthorModule** | Author management |
| **PendingEntityModule** | Entity confirmation workflow |

### Job System

The backend processes jobs asynchronously via a polling system (every 5 seconds) with CPU/memory monitoring (skips execution if >80%):

| Processor | Job Type | Description |
|-----------|----------|-------------|
| DocumentExtractionProcessor | `document-extraction` | Extracts text and metadata from files |
| DetectLanguageProcessor | `detect-language` | Detects content language |
| TranslateProcessor | `translate` | Translates content |
| EntityExtractionProcessor | `entity-extraction` | Extracts named entities |
| IngestContentProcessor | `ingest-content` | Ingests processed content |
| SummarizeProcessor | `summarize` | Generates summaries |
| KeyPointsProcessor | `key-points` | Extracts key points |
| KeywordsProcessor | `keywords` | Extracts keywords |
| AskProcessor | `ask` | Question answering (RAG) |

Job lifecycle: `pending` → `running` → `processed` → `completed` / `failed`

### WebSocket Gateway

Two main events emitted via Socket.io:
- `notification` — Job and resource status updates
- `askResponse` — Real-time RAG query responses

## Migrations

Migrations are managed with TypeORM CLI:

```bash
yarn migration:run        # Run pending migrations
yarn migration:revert     # Revert last migration
yarn migration:generate   # Generate migration from entities
```

## Installation

### With Docker (recommended)

From the repository root:

```bash
docker compose up backend
```

The container automatically runs `yarn install`, migrations, and starts in debug mode.

### Local

```bash
cd backend
yarn install
yarn migration:run
yarn start:dev
```

## File Storage

Files are stored in `/app/documents_storage` with SHA256 hash-based deduplication. The directory structure uses the first 6 characters of the hash:

```
documents_storage/
└── abc/
    └── def/
        └── abcdef1234...ext
```

## License

Apache License, Version 2.0. See the LICENSE file for details.
