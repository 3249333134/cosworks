import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.env.DOTENV_CONFIG_PATH) {
  const path = resolve(process.env.DOTENV_CONFIG_PATH);
  if (!existsSync(path)) throw new Error(`DOTENV_CONFIG_PATH 指向的文件不存在: ${path}`);
  loadDotenv({ path, override: true });
  console.log(`[config] loaded env from ${path}`);
} else {
  loadDotenv({});
}

const number = (value: string | undefined, fallback: number) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boolean = (value: string | undefined, fallback: boolean) => value === undefined ? fallback : value === 'true';

const parseCorsOrigins = (value: string | undefined) => {
  if (!value) return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
};
const isLocalOrigin = (origin: string | undefined) => {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  } catch { return false; }
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: number(process.env.PORT, 5000),
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173',
  corsOrigins: parseCorsOrigins(process.env.PUBLIC_ORIGIN),
  corsAllowAnyLocal: process.env.NODE_ENV !== 'production',
  isAllowedOrigin: (origin: string | undefined) => {
    const allowList = parseCorsOrigins(process.env.PUBLIC_ORIGIN);
    if (!origin) return true;
    if (allowList.includes(origin)) return true;
    if (process.env.NODE_ENV !== 'production' && isLocalOrigin(origin)) return true;
    return false;
  },
  dataMode: process.env.DATA_MODE ?? (process.env.NODE_ENV === 'production' ? 'mysql' : 'memory'),
  dependencyCheckStrict: boolean(process.env.DEPENDENCY_CHECK_STRICT, false),
  db: { host:process.env.DB_HOST ?? '127.0.0.1', port:number(process.env.DB_PORT,3306), database:process.env.DB_NAME ?? 'cosworks', user:process.env.DB_USER ?? 'cosworks_app', password:process.env.DB_PASSWORD ?? '' },
  redis: {
    enabled: boolean(process.env.REDIS_ENABLED, process.env.NODE_ENV === 'production'),
    host:process.env.REDIS_HOST ?? '127.0.0.1',
    port:number(process.env.REDIS_PORT,6379),
    db:number(process.env.REDIS_DB,0),
    username:process.env.REDIS_USERNAME || undefined,
    password:process.env.REDIS_PASSWORD || undefined
  },
  jwtSecret: process.env.JWT_SECRET ?? 'development-only-secret-change-before-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  ai: { provider:process.env.AI_PROVIDER ?? 'local', url:process.env.AI_API_URL ?? '', key:process.env.AI_API_KEY ?? '', model:process.env.AI_MODEL ?? '', timeout:number(process.env.AI_TIMEOUT_MS,20000) }
};

if (config.env === 'production' && config.jwtSecret.startsWith('development-')) throw new Error('JWT_SECRET must be configured in production');
