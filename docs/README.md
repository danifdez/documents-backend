# Documents Backend

The **documents-backend** is a NestJS 10 API that powers an intelligent document processing system. It orchestrates file uploads, text extraction, language detection, translation, named entity recognition, summarization, and real-time notifications -- all through an asynchronous job pipeline backed by PostgreSQL.

## Tech Stack

- **Framework:** NestJS 10 (TypeScript)
- **Database:** PostgreSQL 17.6 with TypeORM
- **Real-time:** Socket.io (WebSocket)

## Quick Start

```bash
# With Docker (recommended)
docker compose up backend

# Without Docker
cd backend
yarn install
yarn migration:run
yarn start:dev
```

See [Getting Started](./getting-started.md) for full setup instructions.

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started.md) | Installation, setup, scripts, and debugging |
| [Job System](./job-system.md) | Async processing pipeline and job processors |
| [File Storage](./file-storage.md) | SHA256 content-addressed storage system |
| [Configuration](./configuration.md) | Environment variables and settings |
