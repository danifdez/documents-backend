## Configuration

All configuration is managed through environment variables. The backend loads them automatically from
a `.env` file placed in the root of the repository (one level above `backend/`).

### Environment variables

#### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `database` | PostgreSQL hostname or IP address |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_USER` | `postgres` | PostgreSQL username |
| `POSTGRES_PASSWORD` | _(empty)_ | PostgreSQL password |
| `POSTGRES_DB` | `documents` | Database name |

#### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the API listens on |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin for browser requests |
| `BODY_LIMIT` | `50mb` | Maximum request body size (applies to JSON and URL-encoded bodies) |

#### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | `false` | Set to `true` to enable JWT authentication |
| `JWT_SECRET` | _(none)_ | Secret key used to sign JWT tokens. **Required** when `AUTH_ENABLED=true` |
| `JWT_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | Refresh token lifetime |

> If `AUTH_ENABLED=true` and `JWT_SECRET` is missing or set to an insecure default,
> the application will refuse to start.

#### Admin seed

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_USERNAME` | _(none)_ | Username for the initial admin account (used by `yarn seed:admin`) |
| `ADMIN_PASSWORD` | _(none)_ | Password for the initial admin account |

#### Models service (AI processing)

| Variable | Default | Description |
|----------|---------|-------------|
| `MODELS_SERVICE_URL` | `http://models:8000` | Base URL of the models/AI processing service |

### Example `.env` file

```dotenv
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=documents

# Server
PORT=3000
CORS_ORIGIN=http://localhost:5173
BODY_LIMIT=50mb

# Authentication
AUTH_ENABLED=true
JWT_SECRET=your-strong-random-secret-here

# Models service
MODELS_SERVICE_URL=http://localhost:8000
```

### Notes

**CORS** — Only the origin specified in `CORS_ORIGIN` is allowed to make cross-origin requests.
For production, set this to the exact URL of your frontend application.

**Body limit** — The `BODY_LIMIT` setting controls how large a request body can be. Increase it
if you need to upload large files through the API. This applies to both JSON and URL-encoded bodies;
file uploads use multipart/form-data and are handled separately.

**TypeORM CLI** — When running migrations from the command line, the CLI reads from `process.env`
directly rather than through NestJS. Make sure the environment variables are exported or the `.env`
file is present before running `yarn migration:run`.
