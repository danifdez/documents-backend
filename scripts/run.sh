#!/bin/sh

# Navigate to the project directory
cd /app

# Run install
yarn install --frozen-lockfile

yarn start:debug