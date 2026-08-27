# Installation options

The person who operates a Documents installation chooses how it connects to its data, who may access it, and which optional processing features are available. End users do not need to configure these services themselves.

## Data and file storage

Documents requires its application database and directories for uploaded files and large background-action artifacts. The database stores projects, metadata, content, relationships, user accounts, processing history, and small artifacts. Original uploads are kept in file storage and are not duplicated when the exact same file already exists. Large artifact bodies are kept outside PostgreSQL while their identity, integrity hash, retention information, and provenance remain in the database.

The storage locations, inline artifact threshold, and database connection are installation-wide choices. Changing them requires administrator access to the server. Backups must include every configured filesystem store and PostgreSQL.

## Application access

An installation can be made available only on the local machine or to approved desktop applications on a network. The administrator also controls the maximum size of application requests; file imports are handled separately.

## Sign-in policy

Authentication is disabled by default for local or single-user use. When enabled, every protected action requires a signed-in account and the relevant permission. The administrator also chooses the lifetime of user sessions and creates the initial administrator account.

See [Accounts and access](./authentication.md) for the roles and available permissions.

## AI processing

AI-assisted actions require a compatible processing service connected to the installation. If no compatible processor is available, the rest of Documents remains usable, but the affected actions cannot be processed until one becomes available.

The enabled capabilities determine whether users can run features such as extraction, transcription, summarization, translation, entity detection, semantic search, and question answering.

## Who should change these options

These are installation-level settings, not personal preferences. Font, language, appearance, workspace selection, and local-server controls are managed from the desktop application's Settings screen. Server, storage, security, and shared AI availability should be managed by the person responsible for the installation.
