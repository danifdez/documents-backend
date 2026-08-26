# Uploaded files

Documents keeps the original files imported into a project so they can be downloaded and processed again when needed. File storage is separate from the project's searchable and editable content.

## Duplicate files

Each upload is identified from its contents, not only from its filename. If the exact same file already exists, Documents rejects the duplicate import and keeps the existing resource. Renaming an unchanged file does not create another stored copy.

Two files with the same name but different contents are treated as different files.

## What is stored

Documents keeps:

- the original uploaded file;
- its original filename and resource metadata;
- extracted content and available metadata produced during processing;
- links to the project, documents, entities, comments, marks, and other related items.

Deleting or replacing processed information does not silently create another copy of the original upload.

## Storage responsibility

In a standalone workspace, application data and uploads are stored on the user's machine. In a remote workspace, they are stored by that Documents server. Users should follow the backup and retention policy of the installation that owns the workspace.

The precise storage location is an administrator setting and is intentionally hidden from normal application use.
