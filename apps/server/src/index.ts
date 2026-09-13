import { startBackground } from './background.js';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { attachWebSocket } from './hub.js';
import { pingCache } from './cache.js';
import { createStore } from './store.js';

const store = createStore();

try {
  await store.ping();
  await store.ensureTimelineSchema();
  if (config.dependencyCheckStrict) await pingCache();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const usingRemote = process.env.DATA_MODE === 'mysql';
  const hint = usingRemote
    ? [
        '',
        'Tip: 若远端机器通过公网暴露，请先在本机启动 SSH 隧道把远端 MySQL/Redis 映射到本地端口：',
        '  ssh -N -L 13306:127.0.0.1:3306 -L 16379:127.0.0.1:6379 <你的SSH用户名>@<远端服务器IP/域名>',
        '然后运行：npm run check-remote',
        '再运行：npm run dev-remote   # tsx watch 模式  或   npm run start-remote   # 编译产物模式',
      ].join('\n')
    : '';
  throw new Error(`Dependency check failed. Verify the SSH tunnel and remote-dev configuration: ${message}${hint}`);
}

const stopBackground=startBackground(store);process.once('SIGTERM',stopBackground);process.once('SIGINT',stopBackground);
const server=createServer(createApp(store));attachWebSocket(server);server.listen(config.port,config.host,()=>console.log(`[ruxiju] API listening on ${config.host}:${config.port}`));
