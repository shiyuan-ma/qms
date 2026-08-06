# 秋名山直播

基于给定直播聚合数据源构建的响应式直播站点，播放器使用 ArtPlayer，并按流类型接入 `hls.js` 与 `mpegts.js`。

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>。

## 生产构建

```bash
npm run build
npm run preview
```

可通过 `PORT` 环境变量指定端口。服务端会代理上游 JSON、图片和直播流；HLS 清单中的子清单、密钥与分片地址会被重写为同源地址。

## 生产部署

生产容器监听宿主机回环地址 `127.0.0.1:19057`，公网域名为 `qms.cfnav.me`。直播流不进入长时媒体缓存，HLS/FLV 仍由服务端按频道令牌同源转发；平台目录使用 20 秒新鲜缓存和 5 分钟 last-good 回退。

```bash
docker compose up -d --build
```

域名由 `kan-nav/ops/nginx/cfnav-content-me.conf` 的统一鉴权入口管理，健康检查地址为 `/healthz`。

## 播放策略

- HLS 优先使用低延迟 `hls.js`，不支持 MSE 时回退浏览器原生 HLS。
- HTTP-FLV 使用 `mpegts.js`，关闭大块预存以降低直播延迟。
- 卡顿超过阈值或网络恢复时自动重连，并使用指数退避避免频繁请求。
- 连续失败的直播源会短时熔断，并从刷新后的频道列表隐藏，避免重复连接离线源。
- 代理端只接受从上游数据或 HLS 清单登记过的资源令牌，不提供任意 URL 代理。

运行 `npm run test:streams` 可校验全部平台目录，并对每个平台的前 3 个频道读取真实媒体数据。可通过 `TEST_TIMEOUT`、`TEST_CONCURRENCY` 和 `TEST_SAMPLE_SIZE` 调整探测范围。
