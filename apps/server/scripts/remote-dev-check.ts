import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import WebSocket from 'ws';

const envPath = process.env.DOTENV_CONFIG_PATH;
if (!envPath) throw new Error('请通过 DOTENV_CONFIG_PATH 指定 .env.remote-dev 路径。示例: pnpm check-remote');
const fullPath = resolve(envPath);
if (!existsSync(fullPath)) throw new Error(`未找到 env 文件: ${fullPath}`);
loadEnv({ path: fullPath, override: true });
console.log(`[remote-dev] using env: ${fullPath}`);

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value;
};
const exact = (name: string, expected: string) => {
  const actual = required(name);
  if (actual !== expected) throw new Error(`${name} must be ${expected}`);
};

exact('DATA_MODE', 'mysql');
exact('DB_HOST', '127.0.0.1');
exact('DB_PORT', '13306');
exact('DB_NAME', 'cosworks_dev');
exact('DB_USER', 'cosworks_dev_app');
exact('REDIS_ENABLED', 'true');
exact('REDIS_HOST', '127.0.0.1');
exact('REDIS_PORT', '16379');
exact('REDIS_DB', '1');

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: required('DB_PASSWORD')
});

try {
  const [databaseRows] = await db.query<mysql.RowDataPacket[]>('SELECT DATABASE() AS name');
  if (databaseRows[0]?.name !== 'cosworks_dev') throw new Error('MySQL selected an unexpected database');
  const [counts] = await db.query<mysql.RowDataPacket[]>(
    'SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM user_ip_roles) AS roles, (SELECT COUNT(*) FROM rooms) AS rooms, (SELECT COUNT(*) FROM game_actions) AS actions'
  );
  const [timelineSchema] = await db.query<mysql.RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='game_sessions' AND column_name='plan_item_id') AS planItemColumn,(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='game_events') AS gameEventsTable");
  if (Number(timelineSchema[0]?.planItemColumn) !== 1 || Number(timelineSchema[0]?.gameEventsTable) !== 1) throw new Error('Timeline schema migration has not been applied');
  let productionAccessDenied = false;
  try {
    await db.query('SELECT 1 FROM cosworks.users LIMIT 1');
  } catch (error) {
    const code = (error as { code?: string }).code;
    productionAccessDenied = code === 'ER_DBACCESS_DENIED_ERROR' || code === 'ER_TABLEACCESS_DENIED_ERROR';
  }
  if (!productionAccessDenied) throw new Error('cosworks_dev_app can access production database');

  await db.beginTransaction();
  try {
    const id = randomUUID();
    await db.execute('INSERT INTO users(id,account,password_hash,display_name) VALUES(?,?,?,?)', [id, `check_${Date.now()}`, 'not-a-login-hash', '联调探活']);
  } finally {
    await db.rollback();
  }
  console.log(`[remote-dev] MySQL OK: users=${counts[0].users}, roles=${counts[0].roles}, rooms=${counts[0].rooms}, actions=${counts[0].actions}`);
} finally {
  await db.end();
}

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  db: 1,
  username: process.env.REDIS_USERNAME || undefined,
  password: required('REDIS_PASSWORD'),
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false
});
try {
  await redis.connect();
  if (await redis.ping() !== 'PONG') throw new Error('Redis did not return PONG');
  const isolationKey = `remote-dev:check:${randomUUID()}`;
  await redis.set(isolationKey, 'db1', 'EX', 30);
  await redis.select(0);
  if (await redis.exists(isolationKey)) throw new Error('A local test key appeared in Redis DB0');
  await redis.select(1);
  await redis.del(isolationKey);
  console.log(`[remote-dev] Redis DB1 OK: keys=${await redis.dbsize()}`);
} finally {
  redis.disconnect();
}

const apiUrl = `http://127.0.0.1:${process.env.PORT || '5000'}/api/health`;
try {
  const response = await fetch(apiUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  console.log('[remote-dev] API OK');

  const token = jwt.sign({ accountId: '00000000-0000-4000-8000-000000000000' }, required('JWT_SECRET'), { expiresIn: '1m' });
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT || '5000'}/ws?token=${encodeURIComponent(token)}&room=CHECK`);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket check timed out')); }, 3000);
    ws.once('message', data => {
      clearTimeout(timer);
      const message = JSON.parse(String(data)) as { type?: string };
      ws.close();
      message.type === 'connected' ? resolve() : reject(new Error('Unexpected WebSocket response'));
    });
    ws.once('error', error => { clearTimeout(timer); reject(error); });
  });
  console.log('[remote-dev] WebSocket OK');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`[remote-dev] API/WebSocket not running: ${message}`);
}
