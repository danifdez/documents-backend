## Authentication

The backend supports JWT-based authentication using Passport.js. Authentication can be fully
enabled or disabled via an environment variable, so it can be turned off for local or single-user
setups without changing any code.

### Enabling authentication

Authentication is controlled by the `AUTH_ENABLED` environment variable:

- `AUTH_ENABLED=false` (default) — all endpoints are publicly accessible with no login required.
  The server logs a warning at startup to make the open state visible.
- `AUTH_ENABLED=true` — all endpoints require a valid JWT unless explicitly marked public.
  The server will refuse to start if `JWT_SECRET` is missing or set to an insecure default value.

### Login flow

```
POST /auth/login
  { username, password }
  → validates credentials
  → returns { accessToken, refreshToken }

POST /auth/refresh
  { refreshToken }
  → returns { accessToken }
```

Access tokens expire after 15 minutes (configurable via `JWT_EXPIRES_IN`).
Refresh tokens expire after 7 days (configurable via `JWT_REFRESH_EXPIRES_IN`).

The login endpoint is rate-limited to 5 requests per minute per IP to prevent brute-force attacks.

### Roles

Every user has one of two roles:

| Role | Description |
|------|-------------|
| `admin` | Full access to all endpoints and operations. Bypasses permission checks. Can manage other users. |
| `user` | Standard access. Subject to fine-grained permission checks. |

### Permissions

In addition to roles, each user account carries a `permissions` JSON field that controls access to
specific capabilities. Permissions are checked by `PermissionsGuard` on every request.

`admin` users bypass permission checking entirely.

Available permissions:

| Permission | Controls access to |
|------------|--------------------|
| `ask` | Question-answering (RAG) |
| `summarize` | AI summarization |
| `translate` | Translation |
| `entity-extraction` | Named entity recognition |
| `key-points` | Key point extraction |
| `keywords` | Keyword extraction |
| `projects` | Project management |
| `upload` | File uploads |
| `export` | Data export |
| `write` | Create and update operations |
| `delete` | Delete operations |

### User management

Users are managed through the following endpoints (admin only):

| Endpoint | Description |
|----------|-------------|
| `GET /users` | List all users |
| `POST /users` | Create a new user |
| `PATCH /users/:id` | Update a user (role, permissions, password) |
| `DELETE /users/:id` | Delete a user |

### Creating the first admin user

Since there are no users in a fresh installation, the `seed:admin` script creates the initial admin:

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD=your_password yarn seed:admin
```

Or set those variables in your `.env` file before running the script.

### Guards

The auth system uses three guards applied globally in `AppModule`:

| Guard | Applied to | Description |
|-------|------------|-------------|
| `ConditionalAuthGuard` | All routes | Enforces JWT verification when `AUTH_ENABLED=true`. Routes decorated with `@Public()` are excluded. |
| `PermissionsGuard` | All routes | Checks per-route permission requirements against the authenticated user's permissions. |
| `ThrottlerGuard` | All routes | Rate limits requests (100 per 60 seconds globally; 5 per minute for login). |
