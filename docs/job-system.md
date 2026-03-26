## Job System

The backend uses a database-backed asynchronous job queue to coordinate AI processing tasks. Jobs are
stored in PostgreSQL — there is no Redis, Bull, or external queue dependency — which keeps the
infrastructure simple and all state in one place.

### Job lifecycle

```
pending ──► processed ──► completed
                │
                └──► failed
```

When a job is created, it starts in `pending` status. The `TaskScheduleService` polls the database
every 5 seconds for the next `processed` job to run. Once the processor finishes, the job transitions
to `completed` or `failed`. Completed and failed jobs are automatically deleted after 48 hours.

### Job priorities

Jobs support two priorities: `high` and `normal`. The scheduler always picks the highest-priority
available job first. This ensures urgent operations (like detecting language after a user action)
are not blocked behind background tasks.

### TaskScheduleService

The scheduler runs three recurring tasks:

| Interval | Task |
|----------|------|
| Every 5 seconds | Pick the next pending job and dispatch it to the appropriate processor |
| Every 30 seconds | Requeue stale jobs (claimed but not completed within 60 seconds); mark unresponsive workers offline |
| Every hour | Delete jobs that have been completed or failed for more than 48 hours |

The scheduler also checks current CPU and memory usage before picking up a new job. If either is
above 80%, it skips that cycle to avoid overloading the server.

### Processors

Processors are auto-discovered at startup: `JobProcessorFactory` scans the `src/job-processor/processors/`
directory and registers every class that implements the `JobProcessor` interface.

Each processor declares which job type it handles via `canProcess(jobType)`.

The 13 built-in processors are:

| Processor | Handles job type | What it does |
|-----------|-----------------|--------------|
| `document-extraction` | `document-extraction` | Sends the file to the models service for text and metadata extraction |
| `detect-language` | `detect-language` | Identifies the language of the extracted text; routes to translation or entity extraction |
| `translate` | `translate` | Translates document content or entities using the models service |
| `entity-extraction` | `entity-extraction` | Processes NER results returned by the models service; creates pending entities |
| `ingest-content` | `ingest-content` | Marks the resource as `ready` and emits a notification to the frontend |
| `summarize` | `summarize` | Receives the AI-generated summary and stores it on the resource |
| `key-points` | `key-points` | Receives the key points list and stores it on the resource |
| `keywords` | `keywords` | Receives the keywords list and stores it on the resource |
| `ask` | `ask` | Handles RAG question-answering; emits the answer to the frontend via WebSocket |
| `dataset-stats` | `dataset-stats` | Computes and stores descriptive statistics for a dataset |
| `delete-vectors` | `delete-vectors` | Removes vector embeddings from Qdrant when a resource is deleted |
| `image-generate` | `image-generate` | Creates a resource from an AI-generated image and notifies the frontend via WebSocket |
| `image-edit` | `image-edit` | Creates a resource from an AI-edited image and notifies the frontend via WebSocket |

### Full document processing pipeline

This is the end-to-end flow from upload to a fully processed document:

```
1. POST /resources/upload
   → file stored on disk
   → resource record created (status: pending)
   → 'document-extraction' job created

2. Models service extracts text and metadata
   → resource status: extracted
   → notification sent to frontend

3. User confirms extraction (or it proceeds automatically)
   → 'detect-language' job created

4. Language detected
   ├── Same as project default → 'entity-extraction' job created
   └── Different language      → 'translate' job created first

5. (If translated) Translation complete
   → 'entity-extraction' job created

6. Named entity recognition runs
   → pending entities created
   → 'translate' job for entity names (if needed)

7. User reviews and confirms entities
   → 'ingest-content' job created

8. Resource status set to 'ready'
   → final notification sent to frontend
   → document available for semantic search
```

### Job entity schema

Each job record in the `jobs` table has the following key fields:

| Field | Description |
|-------|-------------|
| `id` | Auto-incremented integer |
| `type` | String identifier for the job type (e.g. `document-extraction`) |
| `priority` | `high` or `normal` |
| `payload` | JSONB blob with all input data the processor needs |
| `result` | JSONB blob populated by the processor on completion |
| `status` | `pending`, `processed`, `completed`, or `failed` |
| `claimed_by` | UUID of the worker that claimed this job |
| `retry_count` | Number of times this job has been retried |
| `expires_at` | Timestamp after which the job is eligible for cleanup |
