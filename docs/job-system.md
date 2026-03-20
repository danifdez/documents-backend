# Job System

The backend uses a database-backed asynchronous job queue. Instead of Redis or Bull, jobs are stored in the PostgreSQL `jobs` table, processed by an external AI/ML service, and then finalized by NestJS processors.

## Job Lifecycle

```
                      External AI/ML
                        Service
                          |
  pending ───────────> processed ───────────> completed
     |                    |                      |
     |                    v                      |
     |               TaskScheduleService         |
     |               (polls every 5s)            |
     |                    |                      |
     |                    v                      |
     |              JobProcessor                 |
     |              (updates entities,           |
     |               sends notifications)        |
     |                    |                      |
     |                    v                      |
     +────────────────> failed                   |
                                                 v
                                          (expires after 48h,
                                           cleaned up hourly)
```

1. **`pending`** -- Job created by the backend, waiting for the external AI/ML service
2. **`processed`** -- External service has completed and written results to `job.result`
3. **`completed`** -- NestJS processor has finalized the job (updated entities, sent notifications)
4. **`failed`** -- Processing failed at any stage

## TaskScheduleService

Located at `src/task-schedule/task-schedule.service.ts`.

### Job Processing (every 5 seconds)

```typescript
@Cron(CronExpression.EVERY_5_SECONDS, { waitForCompletion: true })
```

On each tick:

1. Check CPU and memory usage -- **skip if either exceeds 80%**
2. Query the oldest job with status `processed`
3. Look up the appropriate processor via `JobProcessorFactory`
4. Execute the processor
5. Mark the job as `completed` or `failed`

The `waitForCompletion: true` option ensures no concurrent processing.

### Cleanup (every hour)

```typescript
@Cron(CronExpression.EVERY_HOUR, { waitForCompletion: true })
```

Deletes jobs where `expires_at` has passed. Jobs are set to expire 48 hours after completion or failure.

## JobProcessorFactory

Located at `src/job-processor/job-processor.factory.ts`.

On module initialization, the factory dynamically discovers and registers all processors:

1. Scans the `src/job-processor/processors/` directory for `.js` files
2. Converts each filename to a PascalCase class name (e.g., `document-extraction-processor.js` -> `DocumentExtractionProcessor`)
3. Resolves the class from the NestJS dependency injection container
4. Registers it if it implements the `JobProcessor` interface

To dispatch a job, `getProcessor(jobType)` iterates through registered processors and returns the first one where `canProcess(jobType)` returns `true`.

## JobProcessor Interface

```typescript
interface JobProcessor {
  process(job: JobEntity): Promise<any>;
  canProcess(jobType: string): boolean;
}
```

## Processors

### document-extraction

**File:** `document-extraction-processor.ts`

Handles text and metadata extraction from uploaded files.

- **Input payload:** `{ hash, extension, resourceId }`
- **Expected result:** `{ title, author, publication_date, content, pages? }`
- **Actions:** Updates resource with extracted content, sets status to `extracted`, sends `notification` event
- **Triggers:** Awaits user confirmation before proceeding

### detect-language

**File:** `detect-language-processor.ts`

Detects the language of extracted content.

- **Input payload:** `{ resourceId, samples }`
- **Expected result:** `{ results: [{ language }] }`
- **Actions:** Updates `resource.language`
- **Triggers:** If language matches default, creates `entity-extraction` job. If different, creates `translate` job first.

### translate

**File:** `translate-processor.ts`

The most complex processor, handling five sub-types based on `payload.translationType`:

| Sub-type | Purpose | Input | Output |
|----------|---------|-------|--------|
| `entities-pending-batch` | Translate extracted entity names before creating pending entities | Entity names + languages | Creates pending entities with translations |
| `entities-batch` | Batch translate confirmed entity names | Entity names + target language | Updates entity translations jsonb |
| `entity` | Single entity translation | Entity name + languages | Updates entity translation |
| `entity-retranslate` | Re-translate a pending entity after name change | New name + languages | Updates pending entity translations |
| *(default)* | Translate HTML content | Resource content + languages | Updates `resource.translatedContent`, preserving HTML structure |

The default content translation uses CSS path mapping to preserve HTML structure -- it extracts text nodes with their paths, sends them for translation, and maps translations back to the correct positions.

After content translation, if the resource status was `translating`, the processor triggers `entity-extraction`.

### entity-extraction

**File:** `entity-extraction-processor.ts`

Processes named entity recognition (NER) results.

- **Input payload:** `{ resourceId, from, texts }`
- **Expected result:** `{ entities: [{ word, entity }] }`
- **Actions:** Clears existing pending entities for the resource, maps spaCy entity tags to entity types, creates a `translate` job (`entities-pending-batch`) for multilingual entity translation
- **Entity tag mapping:** PERSON, ORG, GPE, LOC, EVENT, FAC, PRODUCT, WORK_OF_ART, LANGUAGE, LAW, NORP

### ingest-content

**File:** `ingest-content-processor.ts`

Finalizes content processing after entity confirmation.

- **Input payload:** `{ resourceId }`
- **Actions:** Sets resource status to `ready`, sends `notification` event

### summarize

**File:** `summarize-processor.ts`

Generates content summaries.

- **Input payload:** `{ content, sourceLanguage, targetLanguage, resourceId?, targetDocId?, type? }`
- **Expected result:** `{ response }` (string)
- **Actions:** Either updates `resource.summary` or appends to `doc.content` (when `targetDocId` is provided), sends `notification` event

### key-points

**File:** `key-points-processor.ts`

Extracts key points from content.

- **Input payload:** `{ resourceId, content, targetLanguage? }`
- **Expected result:** `{ key_points: string[] }`
- **Actions:** Updates `resource.keyPoints` (JSON array), sends `notification` event

### keywords

**File:** `keywords-processor.ts`

Extracts keywords from content.

- **Input payload:** `{ resourceId, content, targetLanguage? }`
- **Expected result:** `{ keywords: string[] }`
- **Actions:** Updates `resource.keywords` (JSON array), sends `notification` event

### ask

**File:** `ask-processor.ts`

Handles RAG (Retrieval Augmented Generation) question answering.

- **Input payload:** `{ question }`
- **Expected result:** `{ response }` (string)
- **Actions:** Sends `askResponse` WebSocket event (no database update)

## Resource Processing Pipeline

The complete lifecycle of a resource from upload to ready:

```
1. Upload file
   └── POST /resources/upload
       └── Creates 'document-extraction' job (non-image files)

2. Document extraction (external service)
   └── Extracts text, title, author, publication date, pages
       └── Status: extracting -> extracted
           └── Notification sent to frontend

3. User confirms extraction
   └── POST /resources/:id/confirm
       └── Creates 'detect-language' job
           └── Status: confirmed_extraction

4. Language detection (external service)
   ├── Same language as default -> Go to step 6
   └── Different language -> Go to step 5

5. Content translation (external service)
   └── Translates HTML content preserving structure
       └── Status: translating
           └── After completion, go to step 6

6. Entity extraction (external service)
   └── NER extracts named entities from content
       └── Status: entities
           └── Creates translation job for entity names

7. Entity name translation
   └── Translates entity names to target languages
       └── Creates pending entity records

8. User reviews pending entities
   └── Confirm, merge, or discard entities
       └── POST /pending-entities/resource/:id/confirm
           └── Creates 'ingest-content' job

9. Content ingestion
   └── Finalizes processing
       └── Status: ready
           └── Notification sent to frontend
```

## Creating Custom Jobs

You can create jobs directly via the API:

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "summarize",
    "content": "Text to summarize...",
    "sourceLanguage": "en",
    "targetLanguage": "es",
    "resourceId": 1
  }'
```

## Job Priority

Jobs have three priority levels:

| Priority | Value | Usage |
|----------|-------|-------|
| `normal` | `'normal'` | Default for most operations |
| `high` | `'high'` | Used for entity translations and follow-up jobs |
| `low` | `'low'` | Available for custom jobs |
