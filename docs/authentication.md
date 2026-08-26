# Accounts and access

Documents can operate in two access modes chosen by the administrator:

- **Open access**: no sign-in is required. This is the default and is intended for local or single-user installations.
- **Authenticated access**: users sign in and can only use the capabilities granted to their account.

When authenticated access is enabled, Documents will not start with an unsafe or missing sign-in secret.

## Signing in

Users sign in with a username and password. A successful sign-in creates a short-lived session that is renewed in the background by the application. Access sessions last 15 minutes by default, while the renewal session lasts 7 days by default; an administrator can change these periods.

Repeated failed sign-in attempts are limited to five per minute from the same network address.

## Roles

Every account has one of two roles:

| Role | Access |
|---|---|
| **Administrator** | Full access, including user management and every protected capability. |
| **User** | Access only to the capabilities granted to the account. |

Administrators are not restricted by individual capability permissions.

## User permissions

A standard user can be granted access separately to:

- question answering;
- summarization;
- translation;
- entity extraction;
- key-point extraction;
- keyword extraction;
- project management;
- file uploads;
- exports;
- creating and editing content;
- deleting content.

This makes it possible, for example, to let someone read and search a project without allowing uploads or deletion.

## User management

Administrators can list accounts, create users, change a user's role or permissions, reset a password, and delete an account. The first administrator is created during installation by the person operating the Documents server.
