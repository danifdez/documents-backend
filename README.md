# Documents backend

## Overview

The backend service orchestrates document processing jobs, manages resources, and delivers real-time notifications to the user interface. It acts as the central hub for job creation, resource updates, and communication between the user-facing application and the document processing microservice. The backend maintains job and resource state, triggers processors for various document-related tasks, and ensures integration with the models service for extraction, language detection, summarization, translation, and vector search. All resource changes are handled through a dedicated service, and notifications are emitted to keep the user interface updated.

## Features

- Job orchestration for document processing tasks (extraction, language detection, summarization, translation, entity extraction, ingestion, and question answering)
- Resource management, including creation, update, and deletion of documents, marks, comments, references, and projects
- Real-time notifications to the user interface for job status and resource updates
- Search functionality across documents, resources, marks, and references
- Threaded discussions and comment management for collaborative workflows
- Integration with document processing microservice for advanced analysis and vector search

## Installation

### With Docker

1. Ensure Docker is installed on your system.

2. Build the backend Docker image:

   ```bash
   docker build -t documents-backend ./backend
   ```

3. Run the backend container:

   ```bash
   docker run -p 3000:3000 --env-file ./backend/.env documents-backend
   ```

   Make sure to provide any required environment variables and ensure PostgreSQL is running and accessible to the backend.

### Local

1. Install Node.js and Yarn if not already installed.
2. Navigate to the backend directory:

   ```bash
   cd backend
   ```

3. Install dependencies:

   ```bash
   yarn install
   ```

4. Start the development server:

   ```bash
   yarn start:dev
   ```

5. For testing, run:

   ```bash
   yarn test
   ```

## License

This project is licensed under the Apache License, Version 2.0. See the LICENSE file for details.
