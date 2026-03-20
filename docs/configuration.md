# Configuration

All configuration is managed through environment variables, loaded via `@nestjs/config` (`ConfigModule.forRoot()` registered globally).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `database` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `postgres` | PostgreSQL username |
| `POSTGRES_PASSWORD` | (empty) | PostgreSQL password |
| `POSTGRES_DB` | `documents` | Database name |
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `BODY_LIMIT` | `50mb` | Max request body size (JSON and URL-encoded) |

## Configuration Loading

The `ConfigModule` from `@nestjs/config` is registered as global in `src/app.module.ts`:

```typescript
ConfigModule.forRoot({
  isGlobal: true,
})
```

This means any module can inject `ConfigService` without importing `ConfigModule`.

## Database Configuration

There are two separate database configuration files:

### Runtime Configuration (`src/database/database.providers.ts`)

Used by the running NestJS application. Reads environment variables through `ConfigService`:

```typescript
const host = String(configService.get('POSTGRES_HOST') ?? 'database');
const port = Number(configService.get('POSTGRES_PORT') ?? 5432);
const user = String(configService.get('POSTGRES_USER') ?? 'postgres');
const password = String(configService.get('POSTGRES_PASSWORD') ?? '');
const database = String(configService.get('POSTGRES_DB') ?? 'documents');
```

This also provides a raw `PG_POOL` (from the `pg` package) for direct SQL queries used by the search service.

### CLI Configuration (`typeorm.config.ts`)

Used by the TypeORM CLI for migration commands. Reads directly from `process.env`:

```typescript
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST ?? 'database',
  password: process.env.POSTGRES_PASSWORD ?? 'example',
  // ...
  synchronize: false,
});
```

> **Note:** The CLI config defaults `POSTGRES_PASSWORD` to `'example'`, while the runtime config defaults to an empty string. Ensure you set this variable explicitly in your environment.

## CORS

Configured in `src/main.ts`:

```typescript
app.enableCors({
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  credentials: true,
});
```

Supports a single origin string. To allow multiple origins, you would need to modify `main.ts`.

## Body Parser

Both JSON and URL-encoded parsers are configured with the same size limit:

```typescript
const bodyLimit = process.env.BODY_LIMIT ?? '50mb';
app.use(bodyParser.json({ limit: bodyLimit }));
app.use(bodyParser.urlencoded({ limit: bodyLimit, extended: true }));
```

This accommodates large HTML content payloads sent from the frontend.
