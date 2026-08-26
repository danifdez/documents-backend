# Getting started with a Documents server

This guide explains what a user needs to know when a Documents workspace is provided by a shared server. Installing and maintaining the server itself is covered by the technical documentation in the `documents-dev` project.

## What you need

Ask the administrator for:

- the Documents server address;
- a username and password, if sign-in is enabled;
- confirmation of which AI and file-processing features are available to your account.

If you want everything to run on your own computer, choose the desktop application's standalone mode instead of connecting to a shared server.

## Connect the application

On the first-launch screen, choose **Connect to server** and enter the address provided by the administrator. The application saves this as a workspace, so it can be reopened or used alongside other local and remote workspaces.

If authentication is enabled, sign in with the account supplied by the administrator. The features visible to you depend on that account's permissions.

## Confirm the connection

After connecting, the dashboard shows the projects available in that workspace. Create or open a project, then import a supported file to confirm that storage is available.

AI actions run in the background and require a compatible processing service. If an action remains queued, ask the administrator whether that capability is installed and online.

## Common access problems

- **The server cannot be reached**: verify the workspace address and network connection.
- **Sign-in fails repeatedly**: check the credentials and wait before retrying; repeated attempts are rate-limited.
- **An action is unavailable**: the feature may be disabled for the installation or not granted to your account.
- **An action stays queued**: the required processing service may be busy or offline.
