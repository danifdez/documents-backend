## Getting Started

This guide walks you through installing and running the Documents Backend locally.

### Prerequisites

- **Node.js** 22 or later
- **Yarn** package manager
- **PostgreSQL** 17.6 or later

### Running

**1. Install dependencies**

```bash
cd backend
yarn install
```

**2. Set environment variables**

Create a `.env` file in the project root (one level above `backend/`) or export the variables
directly. At minimum:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=documents
```

See [Configuration](./configuration.md) for a full list of available variables.

**3. Run database migrations**

```bash
yarn migration:run
```

This applies all pending migrations and seeds the initial data (resource types and entity types).

**4. Start the server**

```bash
yarn start:dev
```

The API will be available at `http://localhost:3000`.

### Available scripts

| Script | Description |
|--------|-------------|
| `yarn start:dev` | Start with hot-reload (development) |
| `yarn start:debug` | Start with hot-reload and debugger on port 9229 |
| `yarn start:prod` | Start the compiled production build |
| `yarn build` | Compile TypeScript to `dist/` |
| `yarn test` | Run unit tests |
| `yarn test:e2e` | Run end-to-end tests |
| `yarn migration:run` | Apply all pending database migrations |
| `yarn migration:revert` | Revert the last migration |
| `yarn migration:generate` | Generate a new migration from entity changes |
| `yarn seed:admin` | Create the initial admin user |

### Creating the admin user

On first run, create an admin account with:

```bash
yarn seed:admin
```

This script reads `ADMIN_USERNAME` and `ADMIN_PASSWORD` from the environment (or `.env` file) and
creates the initial admin user, which you can then use to log in.
