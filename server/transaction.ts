import type { Queryable } from './types.js';

export async function transaction<T>(db: Queryable, work: (connection: Queryable) => Promise<T>): Promise<T> {
  const connection = db.connect ? await db.connect() : db;
  try {
    await connection.query('BEGIN');
    const result = await work(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    if ('release' in connection) connection.release();
  }
}
