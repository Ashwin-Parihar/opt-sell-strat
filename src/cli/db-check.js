import { connect } from '../db.js';

let connection;
try {
  connection = await connect();
  const [[row]] = await connection.query('SELECT DATABASE() AS database_name, VERSION() AS mysql_version');
  console.log(`Connected to ${row.database_name} (MySQL ${row.mysql_version})`);
} catch (error) {
  console.error(`Database check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection?.end();
}
