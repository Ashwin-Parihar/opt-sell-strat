import 'dotenv/config';
import mysql from 'mysql2/promise';

export function getConnectionOptions() {
  const url = process.env.DATABASE_URL?.trim();
  const options = url
    ? { uri: url }
    : {
        host: process.env.DATABASE_HOST?.trim(),
        port: Number(process.env.DATABASE_PORT || 3306),
        user: process.env.DATABASE_USERNAME?.trim(),
        password: process.env.DATABASE_PASSWORD,
        database: process.env.DATABASE_NAME?.trim(),
      };

  if (!url && (!options.host || !options.user || !options.database)) {
    throw new Error('Set DATABASE_URL or DATABASE_HOST, DATABASE_USERNAME, and DATABASE_NAME in .env');
  }
  if (!url && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    throw new Error('DATABASE_PORT must be a valid TCP port');
  }
  if (process.env.DB_SSL === 'true') options.ssl = {};
  options.connectTimeout = 10000;
  return options;
}

export async function connect() {
  return mysql.createConnection(getConnectionOptions());
}
