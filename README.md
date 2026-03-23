# Documents Backend

> WARNING: This project is in ALPHA — features are experimental and may change without notice. Use at your own risk.

## Overview

The Documents Backend is the API server that powers the Documents platform — a system for uploading,
organizing, and deeply analyzing documents with AI assistance. It sits between the user interface and
the AI processing layer, coordinating everything from file uploads to intelligent analysis results,
and keeping the interface updated in real time.

If you upload a PDF, the backend takes care of extracting its text, detecting the language, identifying
people and organizations mentioned in it, generating a summary, and making it searchable — without you
having to trigger each of those steps manually.

## Features

### Document management

Upload files of any common format (PDF, Word, HTML, plain text, and more) and the backend stores them
safely, avoiding duplicates automatically. Every document is organized inside a project, and you can
attach marks, comments, and notes to specific parts.

### Automated AI processing pipeline

When a document is uploaded, it enters a processing queue. The backend automatically extracts its text
content, detects the language, translates it if needed, identifies named entities (people, organizations,
locations), generates a summary, extracts keywords and key points, and finally makes the document ready
for semantic search. All of this happens in the background without any manual steps.

### Real-time notifications

As each processing step completes, the interface receives an instant notification via WebSocket so the
user always sees the current state of their documents without needing to refresh.

### Search

Full-text search across documents, marks, references, and the knowledge base, so you can find what you
need across the entire system.

### Projects and organization

Everything is organized into projects. Each project can have threads (workspaces for discussion and
documents), canvases (visual boards), notes, calendar events, timelines, and task lists, giving teams
a centralized space to work.

### Collaboration

Documents support threaded discussions and inline comments. Multiple people can annotate, mark passages,
and discuss content within the same workspace.

### Entities and knowledge base

Named entities (people, organizations, locations, etc.) extracted from documents are stored and linked
across the project. You can confirm, merge, and manage them to build a shared knowledge graph. There is
also a separate knowledge base for manual notes and reference material.

### Datasets

Structured data files (CSV) can be imported as datasets. The backend stores the records, computes
descriptive statistics automatically, and allows querying the data directly.

### Bibliography

Bibliographic references can be imported (BibTeX) and managed per document or project, with full
metadata support (title, authors, year, DOI, ISBN, abstract, and more).

### Export

Documents and their processed content can be exported in various formats for use outside the platform.

### Authentication and access control

The backend supports user accounts with role-based access (admin and user roles) and fine-grained
permission controls. Authentication can be fully disabled for local or single-user deployments.

## Quick start

```bash
cd backend
yarn install
yarn migration:run
yarn start:dev
```

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](./docs/getting-started.md) | Installation, setup, and available scripts |
| [Architecture](./docs/architecture.md) | System modules, data model, and request flow |
| [Job System](./docs/job-system.md) | Async processing pipeline and job processors |
| [File Storage](./docs/file-storage.md) | SHA256 content-addressed storage system |
| [Configuration](./docs/configuration.md) | Environment variables and settings |
| [Authentication](./docs/authentication.md) | Auth system, roles, and permissions |

## License

This project is licensed under the Apache License, Version 2.0. See the LICENSE file for details.
