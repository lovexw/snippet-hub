# Snippet Hub

私有部署的个人「速存」工具：把散落各处的小信息——临时邮箱+密码、常用 API 命令、心爱的提示词、随手速记——集中到一个自己服务器上的网页里，搜索即达、一键复制。

- **四类条目**：账号凭证（密码打码、点显示才露出）／命令 API（等宽展示）／提示词／速记
- **一键复制**：卡片右下角复制全文；账号类型复制「邮箱+密码」完整文本
- **星标常用**：标星置顶，配合「常用收藏」视图
- **全文搜索 + 标签**：`⌘K` 或 `/` 聚焦搜索，标签跨条目归类
- **导入导出**：JSON 备份/恢复
- **零依赖**：Node.js 标准库实现，无需 `npm install`

数据保存在服务器 `data/items.json`，登录会话在内存中（重启服务需重新登录）。

## 部署

### 方式一：Docker Compose（推荐）

```bash
git clone https://github.com/YOUR_NAME/snippet-hub.git
cd snippet-hub

# 设置登录账号密码
echo "AUTH_USER=admin" > .env
echo "AUTH_PASS=你的强密码" >> .env

docker compose up -d
```

### 方式二：Docker

```bash
docker build -t snippet-hub .
docker run -d --name snippet-hub -p 8321:8321 \
  -v $(pwd)/data:/app/data \
  -e AUTH_USER=admin -e AUTH_PASS=你的强密码 \
  snippet-hub
```

### 方式三：直接 Node 运行

```bash
# 需要 Node.js >= 18
AUTH_USER=admin AUTH_PASS=你的强密码 node server.js
```

不设置环境变量时，首次启动会自动生成账号密码并打印在控制台（同时写入 `data/config.json`，权限 600）。

启动后访问 `http://服务器IP:8321`。

## 生产环境建议

1. **上 HTTPS**：用 Nginx / Caddy 反向代理并签发证书，例如 Caddy 一行即可：

   ```
   snip.example.com {
       reverse_proxy 127.0.0.1:8321
   }
   ```

   HTTPS 下浏览器会启用原生剪贴板 API，复制体验更好。
2. **改掉默认密码**：用 `AUTH_USER` / `AUTH_PASS` 环境变量指定，或编辑 `data/config.json` 后重启。
3. **备份**：定期备份 `data/` 目录（一个 JSON 文件，也可以用页面左下角的「导出备份」）。
4. **防火墙**：端口不必对公网开放，仅本机监听 + 反代即可（`PORT=8321` 配合 iptables/安全组限制）。

## 登录安全设计

- 密码比较使用 `timingSafeEqual` 防时序攻击
- 登录接口按 IP 限速：10 分钟内最多 10 次失败尝试
- 会话 Cookie：HttpOnly + SameSite=Lax，有效期 30 天
- 所有条目读写接口均需登录

## 技术栈

单文件 Node.js 服务端（`server.js`，零依赖）+ 单文件前端（`public/index.html`，无框架无构建），总共不到 2000 行，读得懂、改得动。

## License

MIT
