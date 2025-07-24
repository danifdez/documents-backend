#!/bin/sh

# Navigate to the project directory
cd /app

# Run install
yarn install --frozen-lockfile

node_modules/.bin/migrate-mongo up

yarn start:debug