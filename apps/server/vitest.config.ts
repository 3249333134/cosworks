import { defineConfig } from 'vitest/config';
export default defineConfig({test:{env:{AI_PROVIDER:'local',REDIS_ENABLED:'false',DATA_MODE:'memory'}}});
