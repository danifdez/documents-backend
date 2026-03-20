# Getting Started

## Prerequisites

- **Node.js** 22+
- **Yarn** package manager
- **PostgreSQL** 17.6+ (or Docker)
- **Docker** and **Docker Compose** (recommended)

## Setup with Docker (Recommended)

The easiest way to run the backend is via Docker Compose from the project root:

```bash
docker compose up backend
```

This starts the backend service along with the PostgreSQL database. The container startup script (`scripts/run.sh`) automatically:

1. Runs `yarn install`
2. Runs database migrations (`yarn migration:run`)
3. Starts the server in debug mode (`yarn start:debug`)

The API will be available at `http://localhost:3000` and the debugger at `0.0.0.0:9229`.

### Docker Configuration

- **Base image:** `node:22`
- **Working directory:** `/app`
- **Exposed port:** 3000 (API), 9229 (debugger)
- **Volumes:**
  - `./backend:/app` -- Source code (live reload)
  - `./documents:/app/documents_storage:rw` -- Shared file storage
- **User:** Runs as `node` user (non-root)

## Setup Without Docker

### 1. Install Dependencies

```bash
cd backend
yarn install
```

### 2. Configure Environment

Set the required environment variables (see [Configuration](./configuration.md) for all options):

```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=your_password
export POSTGRES_DB=documents
```

### 3. Run Migrations

```bash
yarn migration:run
```

### 4. Start the Server

```bash
# Development with hot-reload
yarn start:dev

# Debug mode (with hot-reload + debugger on 0.0.0.0:9229)
yarn start:debug

# Production
yarn build
yarn start:prod
```

## Available Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `build` | `nest build` | Compile TypeScript to `dist/` |
| `start` | `nest start` | Start the compiled application |
| `start:dev` | `nest start --watch` | Development with hot-reload |
| `start:debug` | `nest start --debug 0.0.0.0:9229 --watch` | Debug mode with hot-reload |
| `start:prod` | `node dist/main` | Production runtime |
| `lint` | `eslint "{src,apps,libs,test}/**/*.ts" --fix` | Lint and auto-fix |
| `format` | `prettier --write "src/**/*.ts" "test/**/*.ts"` | Format code with Prettier |
| `test` | `jest` | Run unit tests |
| `test:watch` | `jest --watch` | Run tests in watch mode |
| `test:cov` | `jest --coverage` | Run tests with coverage report |
| `test:debug` | `node --inspect-brk ... jest --runInBand` | Debug tests |
| `test:e2e` | `jest --config ./test/jest-e2e.json` | Run end-to-end tests |
| `migration:run` | `typeorm migration:run` | Apply pending migrations |
| `migration:revert` | `typeorm migration:revert` | Revert the last migration |
| `migration:generate` | `typeorm migration:generate ./migrations/Init` | Generate a migration from entity changes |

## Managing Migrations

Migrations are managed with the TypeORM CLI through the root `typeorm.config.ts` configuration file.

### Run pending migrations

```bash
yarn migration:run
```

### Revert the last migration

```bash
yarn migration:revert
```

### Generate a new migration from entity changes

```bash
yarn migration:generate
```

> **Note:** `synchronize` is disabled in the TypeORM configuration. All schema changes must go through migrations.

Migration files are located in the `migrations/` directory and follow a timestamp-based naming convention (e.g., `1757668140000-CreateProjects.ts`).

## Seed Data

Two seed migrations run automatically with `migration:run`:

- **SeedResourceTypes** -- Loads 51 resource type definitions from `data/resource-type.csv`
- **SeedEntityTypes** -- Creates the entity type taxonomy: PERSON, ORGANIZATION, GEOPOLITICAL, LOCATION, NATIONALITY, EVENT, FACILITY, PRODUCT, WORK_OF_ART, LANGUAGE, LAW

## Debugging

In debug mode (`yarn start:debug`), the Node.js debugger listens on `0.0.0.0:9229`.

### VS Code

Add this configuration to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "attach",
  "name": "Attach to Backend",
  "port": 9229,
  "address": "localhost",
  "restart": true,
  "sourceMaps": true,
  "localRoot": "${workspaceFolder}/backend",
  "remoteRoot": "/app"
}
```

### Chrome DevTools

Open `chrome://inspect` in Chrome and click "Configure" to add `localhost:9229` as a target.

## E2E Testing

A separate Docker Compose file is available for E2E tests:

```bash
docker compose -f docker-compose.e2e.yml up
```

This creates an isolated `documents_e2e` database on port 5433.
