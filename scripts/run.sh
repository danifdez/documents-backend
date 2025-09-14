#!/bin/sh

# Navigate to the project directory
cd /app

# Run install
yarn install

yarn migration:run

yarn start:debug