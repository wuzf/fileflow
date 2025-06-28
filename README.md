# FileFlow

FileFlow 是一个基于 Cloudflare Workers 的轻量文件与剪贴板管理工具。

它把前端页面、API 路由和业务逻辑都放在 `src/index.js` 中，通过 Cloudflare KV 保存文件和文本内容。

## 功能特性

- 文件列表查看、下载、删除
- 多文件上传，支持拖拽上传
- 支持从剪贴板直接粘贴文件上传
- 剪贴板文本保存、编辑、删除、复制
- 简单密码鉴权，未登录无法访问页面和 API
- 单文件部署，无需额外前端构建流程

## 鉴权说明

项目现在默认启用密码鉴权。

- 浏览器访问首页时，未登录会先看到登录页
- 登录成功后会写入一个基于 Cookie 的登录态
- 登录态默认保留 7 天
- 所有页面访问和 API 请求都会经过鉴权检查

补充说明：文件的直链下载（例如 `GET /example.pdf`）允许匿名访问，不需要先登录；文件列表、上传、删除以及剪贴板相关操作仍然需要登录。

### 本地开发配置

在项目根目录创建 `.dev.vars`：

```env
ACCESS_PASSWORD=your-password
```

### 线上部署配置

部署到 Cloudflare Workers 前，需要把密码配置为 Secret：

```bash
wrangler secret put ACCESS_PASSWORD
```

如果未配置 `ACCESS_PASSWORD`，线上会显示“未完成鉴权配置”提示页。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 配置本地密码

在根目录新建 `.dev.vars`：

```env
ACCESS_PASSWORD=your-password
```

### 4. 启动本地开发

```bash
npm run dev
```

默认访问地址：`http://localhost:8787`

### 5. 运行测试

```bash
npm test
```

## 部署说明

### 直接部署

```bash
npm run deploy
```

等价命令：

```bash
npx wrangler deploy
```

### 部署前必须检查

1. 已执行 `npx wrangler login`
2. 已配置 `ACCESS_PASSWORD`
3. `wrangler.jsonc` 中的 KV 绑定属于你的 Cloudflare 账号

### 如果 KV 绑定不属于当前账号

先创建新的 KV Namespace：

```bash
npx wrangler kv namespace create FILE
npx wrangler kv namespace create NOTE
```

然后把返回的 `id` 更新到 `wrangler.jsonc` 中对应的 `kv_namespaces` 配置里，再重新部署。

## 存储结构

项目使用两个 Cloudflare KV 命名空间：

- `FILE`：保存上传的文件内容
- `NOTE`：保存剪贴板文本内容

## 主要路由

### 鉴权

- `POST /auth/login`：登录
- `POST /auth/logout`：退出登录

### 文件

- `GET /`：首页
- `GET /list`：获取文件列表
- `POST /upload`：上传文件
- `DELETE /delete/{name}`：删除文件
- `GET /{name}`：下载文件

### 剪贴板

- `GET /note`：获取剪贴板列表
- `POST /note`：新增剪贴板内容
- `PUT /note/update/{key}`：更新剪贴板内容
- `DELETE /note/delete/{key}`：删除剪贴板内容

## 项目结构

```text
.
├─ src/
│  └─ index.js          # Worker 主逻辑、页面模板、API
├─ test/
│  └─ index.spec.js     # Vitest 测试
├─ wrangler.jsonc       # 当前使用的 Wrangler 配置
├─ wrangler.toml        # 旧配置文件，保留中
└─ README.md
```

## 开发说明

### 页面实现方式

前端页面通过 `generateHomePage()`、`generateLoginPage()` 等函数直接生成 HTML，样式和脚本都以内联方式写在 Worker 中。

### 当前前端能力

- 文件页与剪贴板页 Tab 切换
- 文件拖拽上传
- 粘贴文件上传
- 剪贴板文本编辑与复制
- 退出登录

### 测试方式

测试使用 `Vitest`，通过内存版 KV Mock 验证核心行为，不依赖 Cloudflare Workers 测试池。

当前测试覆盖：

- 未登录访问首页时返回登录页
- 正确密码登录
- 错误密码登录失败
- 已登录访问首页
- 未登录访问 API 被拒绝
- 剪贴板空内容校验
- 剪贴板更新成功
- 更新不存在的剪贴板项返回 404

## 限制说明

- 单个文件大小受 Cloudflare Workers 平台限制
- 文件与文本内容都存储在 Cloudflare KV 中，请关注容量与配额
- 中文文件名下载会通过 URL 编码处理

## 许可证

MIT
