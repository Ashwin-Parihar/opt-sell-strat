import { connect } from '../db.js';

let connection;
try {
  connection = await connect();
  const [columns] = await connection.query(`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
    ORDER BY table_name, ordinal_position
  `);
  const tables = {};
  for (const column of columns) {
    (tables[column.table_name] ??= []).push({
      name: column.column_name,
      type: column.data_type,
      nullable: column.is_nullable === 'YES',
    });
  }
  console.log(JSON.stringify(tables, null, 2));
} catch (error) {
  console.error(`Database inspection failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection?.end();
}
