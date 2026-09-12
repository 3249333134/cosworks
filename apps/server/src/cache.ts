import Redis from 'ioredis';
import { config } from './config.js';

let client: Redis | null = null;

function redis() {
  if (!config.redis.enabled) return null;
  if (!client) {
    client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
      username: config.redis.username,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false
    });
    client.on('error', error => console.warn('[redis]', error.message));
  }
  return client;
}

async function connected() {
  const value = redis();
  if (!value) return null;
  if (value.status === 'wait') await value.connect();
  return value;
}

export async function pingCache() {
  const value = await connected();
  if (!value) throw new Error('Redis is disabled');
  await value.ping();
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const value = await connected();
    const raw = value ? await value.get(key) : null;
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}

export async function cacheSet(key: string, payload: unknown, ttlSeconds = 900) {
  try {
    const value = await connected();
    if (value) await value.set(key, JSON.stringify(payload), 'EX', ttlSeconds);
  } catch { /* MySQL/local rules remain authoritative when Redis is unavailable. */ }
}

export async function markOnline(roomCode: string, accountId: string, online: boolean) {
  try {
    const value = await connected();
    if (!value) return;
    const key = `room:${roomCode}:online`;
    if (online) await value.sadd(key, accountId); else await value.srem(key, accountId);
    await value.expire(key, 86_400);
  } catch { /* Presence is best effort. */ }
}

export async function closeCache() {
  if (client) await client.quit().catch(() => undefined);
}
