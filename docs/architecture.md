# How Documents works

Documents keeps a project's information together and makes it available to the desktop application. It stores the user's work, coordinates longer-running processing, and keeps every connected application up to date.

## Organizing work

Everything belongs to a project. Within a project, users can work with:

- uploaded resources and their extracted content;
- editable documents, highlights, and comments;
- threads, notes, tasks, calendars, timelines, and visual canvases;
- bibliographic references and links between resources;
- confirmed entities and candidates awaiting review;
- curated knowledge entries;
- structured datasets and their analyses.

This separation keeps one project's content and searches distinct from another project's content.

## From import to usable content

When a file is imported, Documents:

1. checks whether the same file already exists;
2. stores the original file;
3. extracts the content and available metadata;
4. makes the result available for reading, editing, searching, and analysis;
5. reports progress and completion in the application.

Depending on the file and the enabled AI features, additional actions can detect its language, create a summary, translate it, identify entities or dates, extract key points and keywords, or prepare it for semantic search.

## Background processing

Actions that can take time run in the background. The application can remain in use while they are queued or processed. Documents records their progress, retries work that was interrupted when possible, and only publishes a result after the complete action has finished.

An action can finish successfully, fail, be cancelled, or temporarily wait for another step. Completion and failure notifications appear in the desktop application without requiring the user to refresh the current page.

## Search and answers

Documents supports both direct search and meaning-based search across the content available in the current project. Question answering uses relevant passages selected from that project and, when available, project-scoped relationships between entities. Answers are generated from this supplied context; the AI processing service does not broaden the search to other projects.

## Access and continuity

An installation can run without sign-in for a local or single-user setup, or require accounts for shared use. When accounts are enabled, roles and permissions control the available actions.

Documents stores application state independently from the desktop interface. This allows connected applications to reload the current information and supports offline bundles and later synchronization where those features are available.
