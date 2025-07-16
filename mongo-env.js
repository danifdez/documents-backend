// Load .env variables
require('dotenv').config();

const {
  MONGO_USERNAME = 'root',
  MONGO_PASSWORD = 'example',
  MONGO_HOST = 'database',
  MONGO_PORT = '27017',
  MONGO_DATABASE = 'documents',
} = process.env;

const mongoUrl = `mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOST}:${MONGO_PORT}`;

module.exports = {
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_HOST,
  MONGO_PORT,
  MONGO_DATABASE,
  mongoUrl,
};
