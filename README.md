# fileflow

一个基于 Cloudflare Workers 的简单文件管理系统，支持文件的上传、下载和删除功能。

## 功能特点

- 文件上传：支持任意类型文件的上传
- 文件下载：支持所有常见文件类型的下载
- 文件删除：支持删除已上传的文件
- 文件列表：实时显示所有已上传的文件
- 进度显示：上传时显示进度条
- 响应式设计：适配各种屏幕尺寸

## 使用方法

1. 访问系统首页，可以看到文件上传表单和文件列表
2. 点击"选择文件"按钮选择要上传的文件
3. 点击"上传"按钮开始上传
4. 上传成功后，文件会出现在文件列表中
5. 点击文件名可以下载文件
6. 点击文件旁边的"删除"按钮可以删除文件

## 开发说明

### 环境准备

1. 安装 Wrangler CLI：
```bash
npm install -g wrangler
```

2. 登录到 Cloudflare 账户：
```bash
wrangler login
```

### 本地开发

1. 安装依赖：
```bash
npm install
```

2. 启动开发服务器：
```bash
npm run dev
```

3. 访问 http://localhost:8787 查看效果

### KV 存储操作

1. 创建 KV 命名空间：
```bash
wrangler kv namespace create FILE
```

2. 配置 wrangler.toml：
```toml
name = "fileflow"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "FILE"
id = "your-namespace-id"
```

3. KV 命名空间管理：
```bash
# 查看所有 KV 命名空间
wrangler kv namespace list

# 删除 KV 命名空间
wrangler kv namespace delete --namespace-id=your-namespace-id
```

4. KV 文件操作：
```bash
# 上传文件到 KV
wrangler kv key put --namespace-id=your-namespace-id filename --path=path/to/file --remote

# 查看 KV 中的文件列表
wrangler kv key list --namespace-id=your-namespace-id --remote

# 获取 KV 中的文件内容
wrangler kv key get --namespace-id=your-namespace-id filename

# 删除 KV 中的文件
wrangler kv key delete --namespace-id=your-namespace-id filename --remote
```

### 部署

使用以下命令部署到 Cloudflare Workers：
```bash
npm run deploy
```
或者
```bash
wrangler deploy
```


## 技术栈

- Cloudflare Workers
- Cloudflare KV 存储
- HTML5
- CSS3
- JavaScript (ES6+)

## 注意事项

1. 文件大小限制：由于 Cloudflare Workers 的限制，单个文件大小不能超过 100MB
2. 存储限制：请确保您的 Cloudflare KV 存储空间足够
3. 文件类型：支持所有常见文件类型，系统会自动识别文件类型并设置正确的 MIME 类型

## 错误处理

系统包含完整的错误处理机制：
- 上传失败时会显示错误信息
- 删除文件时会有确认提示
- 所有操作都有成功/失败的反馈

## 贡献

欢迎提交 Issue 和 Pull Request 来帮助改进这个项目。

## 许可证

MIT License 