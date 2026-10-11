const AUTH_COOKIE_NAME = 'fileflow_auth';
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * 文件管理系统
 * 基于 Cloudflare Workers 实现的文件上传、下载和删除服务
 * 
 * 主要功能：
 * - 文件上传：支持多文件上传、拖拽上传
 * - 文件下载：支持所有常见文件类型的下载
 * - 文件删除：支持删除已上传的文件
 * - 文件列表：实时显示所有已上传的文件
 * - 剪贴板：支持文本内容的云端剪贴、查看和删除
 */

export default {
	/**
	 * 处理所有请求的主函数
	 * @param {Request} request - 请求对象
	 * @param {Object} env - 环境变量
	 * @param {Object} ctx - 上下文对象
	 * @returns {Response} 响应对象
	 */
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		
		// 路由处理
		try {
			const authResponse = await this.handleAuthentication(request, url, env);
			if (authResponse) {
				return authResponse;
			}
			// 首页路由
			if (url.pathname === '/') {
				return await this.handleHomePage(env);
			}
			
			// 文件列表API
			if (url.pathname === '/list') {
				return await this.handleFileList(env);
			}
			
			// 文件删除API
			if (url.pathname.startsWith('/delete/') && request.method === 'DELETE') {
				return await this.handleFileDelete(url, env);
			}
			
			// 文件上传API
			if (url.pathname === '/upload' && request.method === 'POST') {
				return await this.handleFileUpload(request, env);
			}

			// 剪贴板API
			if (url.pathname === '/note' && request.method === 'GET') {
				return await this.handleNoteList(env);
			}
			if (url.pathname === '/note' && request.method === 'POST') {
				return await this.handleNoteAdd(request, env);
			}
			if (url.pathname.startsWith('/note/update/') && request.method === 'PUT') {
				return await this.handleNoteUpdate(url, request, env);
			}

			// 新增：剪贴内容删除API
			if (url.pathname.startsWith('/note/delete/') && request.method === 'DELETE') {
				return await this.handleNoteDelete(url, env);
			}

			// 文件下载处理
			return await this.handleFileDownload(url, env);
		} catch (error) {
			return this.createErrorResponse(error.message || '服务器内部错误', 500);
		}
	},

	// ==================== 后端API处理函数 ====================

	/**
	 * 处理首页请求
	 * @param {Object} env - 环境变量
	 * @returns {Response} HTML页面响应
	 */
	async handleHomePage(env) {
		try {
			const fileList = await this.listAllFiles(env);
			return new Response(this.generateHomePage(fileList), {
				headers: {
					'content-type': 'text/html;charset=UTF-8',
					'cache-control': 'no-store',
				},
			});
		} catch (error) {
			return this.createErrorResponse('获取文件列表失败', 500);
		}
	},

	async handleAuthentication(request, url, env) {
		const password = this.getAccessPassword(env);

		if (this.isPublicFileDownloadRequest(url, request.method)) {
			return null;
		}

		if (url.pathname === '/auth/login' && request.method === 'POST') {
			if (!password) {
				return this.createAuthConfigResponse(request);
			}

			return await this.handleAuthLogin(request, password);
		}

		if (url.pathname === '/auth/logout' && request.method === 'POST') {
			return this.handleAuthLogout(request);
		}

		if (!password) {
			return this.createAuthConfigResponse(request);
		}

		if (await this.isAuthenticated(request, password)) {
			return null;
		}

		return this.createUnauthorizedResponse(request);
	},

	getAccessPassword(env) {
		return String(env.ACCESS_PASSWORD || '').trim();
	},

	isPublicFileDownloadRequest(url, method) {
		if (method !== 'GET') {
			return false;
		}

		if (url.pathname === '/') {
			return false;
		}

		if (
			url.pathname === '/list'
			|| url.pathname === '/upload'
			|| url.pathname === '/note'
			|| url.pathname.startsWith('/delete/')
			|| url.pathname.startsWith('/note/')
			|| url.pathname.startsWith('/auth/')
		) {
			return false;
		}

		return true;
	},

	async handleAuthLogin(request, password) {
		try {
			const data = await request.json();
			const submittedPassword = typeof data.password === 'string' ? data.password : '';

			if (!submittedPassword) {
				return this.createErrorResponse('请输入访问密码', 400);
			}

			if (submittedPassword !== password) {
				return this.createErrorResponse('密码错误', 401);
			}

			const token = await this.createAuthToken(password);
			return new Response(JSON.stringify({ success: true }), {
				headers: {
					'content-type': 'application/json',
					'set-cookie': this.createAuthCookie(token, request),
				},
			});
		} catch (error) {
			return this.createErrorResponse('登录失败', 500);
		}
	},

	handleAuthLogout(request) {
		return new Response(JSON.stringify({ success: true }), {
			headers: {
				'content-type': 'application/json',
				'set-cookie': this.clearAuthCookie(request),
			},
		});
	},

	async isAuthenticated(request, password) {
		const cookies = this.parseCookies(request.headers.get('cookie'));
		const token = cookies[AUTH_COOKIE_NAME];

		if (!token) {
			return false;
		}

		const expectedToken = await this.createAuthToken(password);
		return token === expectedToken;
	},

	/**
	 * 读取所有分页，确保排序覆盖完整文件列表
	 * @param {Object} env - 环境变量
	 * @returns {Promise<Object>} 文件列表及其元数据
	 */
	async listAllFiles(env) {
		const keys = [];
		let cursor;
		do {
			const page = await env.FILE.list(cursor ? { cursor } : {});
			keys.push(...page.keys);
			cursor = page.list_complete === false ? page.cursor : undefined;
		} while (cursor);
		return { keys };
	},

	/**
	 * 处理文件列表API请求
	 * @param {Object} env - 环境变量
	 * @returns {Response} JSON响应
	 */
	async handleFileList(env) {
		try {
			const fileList = await this.listAllFiles(env);
			return new Response(JSON.stringify(fileList.keys), {
				headers: {
					'content-type': 'application/json',
					'cache-control': 'no-store',
				},
			});
		} catch (error) {
			return this.createErrorResponse('获取文件列表失败', 500);
		}
	},

	/**
	 * 处理文件删除请求
	 * @param {URL} url - 请求URL
	 * @param {Object} env - 环境变量
	 * @returns {Response} JSON响应
	 */
	async handleFileDelete(url, env) {
		try {
			const fileName = decodeURIComponent(url.pathname.substring(8));
			await env.FILE.delete(fileName);
			return new Response(JSON.stringify({ success: true }), {
				headers: {
					'content-type': 'application/json',
				},
			});
		} catch (error) {
			return this.createErrorResponse('文件删除失败', 500);
		}
	},

	/**
	 * 处理文件上传请求
	 * @param {Request} request - 请求对象
	 * @param {Object} env - 环境变量
	 * @returns {Response} JSON响应
	 */
	async handleFileUpload(request, env) {
		try {
			const formData = await request.formData();
			const files = formData.getAll('files');
			
			if (!files || files.length === 0) {
				return this.createErrorResponse('未选择文件', 400);
			}

			const results = [];
			for (const file of files) {
				try {
					if (!(file instanceof File)) {
						throw new Error('无效的文件对象');
					}
					
					const fileBuffer = await file.arrayBuffer();
					const uploadedAt = Date.now();
					await env.FILE.put(file.name, fileBuffer, { metadata: { uploadedAt } });
					results.push({
						name: file.name,
						uploadedAt,
						success: true
					});
				} catch (error) {
					console.error('文件上传错误:', error);
					results.push({
						name: file.name,
						success: false,
						error: error.message || '文件上传失败'
					});
				}
			}
			
			return new Response(JSON.stringify({ 
				success: true,
				results: results
			}), {
				headers: {
					'content-type': 'application/json',
				},
			});
		} catch (error) {
			console.error('上传处理错误:', error);
			return this.createErrorResponse(error.message || '文件上传失败', 500);
		}
	},

	/**
	 * 处理文件下载请求
	 * @param {URL} url - 请求URL
	 * @param {Object} env - 环境变量
	 * @returns {Response} 文件响应
	 */
	async handleFileDownload(url, env) {
		try {
			const fileName = decodeURIComponent(url.pathname.substring(1));
			const fileContent = await env.FILE.get(fileName, { type: 'arrayBuffer' });
			
			if (!fileContent) {
				return this.createErrorResponse('文件不存在', 404);
			}
			
			const contentType = this.getContentType(fileName);
			
			return new Response(fileContent, {
				headers: {
					'content-type': contentType,
					'content-disposition': `attachment; filename="${fileName}"`,
					'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
					'Pragma': 'no-cache',
					'Expires': '0'
				},
			});
		} catch (error) {
			return this.createErrorResponse('获取文件失败', 500);
		}
	},

	/**
	 * 获取剪贴板内容列表
	 * @param {Object} env
	 * @returns {Response}
	 */
	async handleNoteList(env) {
		try {
			const list = await env.NOTE.list();
			const notes = [];
			for (const item of list.keys) {
				const value = await env.NOTE.get(item.name, { type: 'json' });
				if (value) notes.push({ ...value, key: item.name }); // 带上key
			}
			// 按最近更新时间倒序
			notes.sort((a, b) => (b.updatedTime || b.time) - (a.updatedTime || a.time));
			return new Response(JSON.stringify(notes), {
				headers: { 'content-type': 'application/json' },
			});
		} catch (error) {
			return this.createErrorResponse('获取剪贴内容失败', 500);
		}
	},

	/**
	 * 新增剪贴板内容
	 * @param {Request} request
	 * @param {Object} env
	 * @returns {Response}
	 */
	async handleNoteAdd(request, env) {
		try {
			const data = await request.json();
			const content = (data.content || '').trim();
			if (!content) {
				return this.createErrorResponse('内容不能为空', 400);
			}
			console.log('收到剪贴内容:', content);
			const note = {
				content,
				time: Date.now(),
			};
			const key = 'note_' + note.time + '_' + Math.random().toString(36).slice(2, 8);
			await env.NOTE.put(key, JSON.stringify(note));
			console.log('已写入 NOTE:', key);
			return new Response(JSON.stringify({ success: true }), {
				headers: { 'content-type': 'application/json' },
			});
		} catch (error) {
			console.log('剪贴内容写入异常:', error);
			return this.createErrorResponse('剪贴失败', 500);
		}
	},

	/**
	 * 更新剪贴板内容
	 * @param {URL} url
	 * @param {Request} request
	 * @param {Object} env
	 * @returns {Response}
	 */
	async handleNoteUpdate(url, request, env) {
		try {
			const key = decodeURIComponent(url.pathname.substring('/note/update/'.length));
			const data = await request.json();
			const content = (data.content || '').trim();

			if (!content) {
				return this.createErrorResponse('内容不能为空', 400);
			}

			const currentNote = await env.NOTE.get(key, { type: 'json' });
			if (!currentNote) {
				return this.createErrorResponse('剪贴内容不存在', 404);
			}

			const updatedTime = Date.now();
			await env.NOTE.put(key, JSON.stringify({
				...currentNote,
				content,
				updatedTime,
			}));

			return new Response(JSON.stringify({ success: true, updatedTime }), {
				headers: { 'content-type': 'application/json' },
			});
		} catch (error) {
			console.log('剪贴内容更新异常:', error);
			return this.createErrorResponse('更新剪贴内容失败', 500);
		}
	},

	/**
	 * 新增：处理剪贴板内容删除请求
	 * @param {URL} url
	 * @param {Object} env
	 * @returns {Response}
	 */
	async handleNoteDelete(url, env) {
		try {
			const key = decodeURIComponent(url.pathname.substring('/note/delete/'.length));
			await env.NOTE.delete(key);
			return new Response(JSON.stringify({ success: true }), {
				headers: { 'content-type': 'application/json' },
			});
		} catch (error) {
			return this.createErrorResponse('剪贴内容删除失败', 500);
		}
	},

	// ==================== 工具函数 ====================

	/**
	 * 根据文件名获取对应的Content-Type
	 * @param {string} fileName - 文件名
	 * @returns {string} Content-Type
	 */
	getContentType(fileName) {
		const extension = fileName.toLowerCase().split('.').pop();
		const mimeTypes = {
			// 文档类型
			'txt': 'text/plain',
			'html': 'text/html',
			'htm': 'text/html',
			'css': 'text/css',
			'js': 'application/javascript',
			'json': 'application/json',
			'xml': 'application/xml',
			'md': 'text/markdown',
			'yml': 'application/x-yaml',
			'yaml': 'application/x-yaml',
			
			// 图片类型
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'png': 'image/png',
			'gif': 'image/gif',
			'svg': 'image/svg+xml',
			'webp': 'image/webp',
			'bmp': 'image/bmp',
			'ico': 'image/x-icon',
			
			// 音频类型
			'mp3': 'audio/mpeg',
			'wav': 'audio/wav',
			'ogg': 'audio/ogg',
			'm4a': 'audio/mp4',
			
			// 视频类型
			'mp4': 'video/mp4',
			'webm': 'video/webm',
			'mov': 'video/quicktime',
			'avi': 'video/x-msvideo',
			
			// 压缩文件
			'zip': 'application/zip',
			'rar': 'application/x-rar-compressed',
			'7z': 'application/x-7z-compressed',
			'tar': 'application/x-tar',
			'gz': 'application/gzip',
			
			// Office文档
			'doc': 'application/msword',
			'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'xls': 'application/vnd.ms-excel',
			'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'ppt': 'application/vnd.ms-powerpoint',
			'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			'pdf': 'application/pdf',
			
			// 字体文件
			'ttf': 'font/ttf',
			'otf': 'font/otf',
			'woff': 'font/woff',
			'woff2': 'font/woff2',
			
			// 其他常见类型
			'csv': 'text/csv',
			'sql': 'application/sql',
			'iso': 'application/x-iso9660-image',
			'apk': 'application/vnd.android.package-archive',
			'exe': 'application/x-msdownload',
			'dll': 'application/x-msdownload',
			'msi': 'application/x-msdownload'
		};
		
		return mimeTypes[extension] || 'application/octet-stream';
	},

	/**
	 * 创建错误响应
	 * @param {string} message - 错误信息
	 * @param {number} status - HTTP状态码
	 * @returns {Response} 错误响应
	 */
	createErrorResponse(message, status) {
		return new Response(JSON.stringify({ error: message }), { 
			status,
			headers: {
				'content-type': 'application/json',
			},
		});
	},

	parseCookies(cookieHeader) {
		const cookies = {};

		if (!cookieHeader) {
			return cookies;
		}

		for (const segment of cookieHeader.split(';')) {
			const trimmedSegment = segment.trim();
			if (!trimmedSegment) {
				continue;
			}

			const separatorIndex = trimmedSegment.indexOf('=');
			if (separatorIndex === -1) {
				continue;
			}

			const key = trimmedSegment.slice(0, separatorIndex).trim();
			const value = trimmedSegment.slice(separatorIndex + 1).trim();
			cookies[key] = value;
		}

		return cookies;
	},

	async createAuthToken(password) {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
		return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
	},

	createAuthCookie(token, request) {
		const cookieParts = [
			`${AUTH_COOKIE_NAME}=${token}`,
			'Path=/',
			'HttpOnly',
			'SameSite=Lax',
			`Max-Age=${AUTH_COOKIE_MAX_AGE}`,
		];

		if (request && new URL(request.url).protocol === 'https:') {
			cookieParts.push('Secure');
		}

		return cookieParts.join('; ');
	},

	clearAuthCookie(request) {
		const cookieParts = [
			`${AUTH_COOKIE_NAME}=`,
			'Path=/',
			'HttpOnly',
			'SameSite=Lax',
			'Max-Age=0',
		];

		if (request && new URL(request.url).protocol === 'https:') {
			cookieParts.push('Secure');
		}

		return cookieParts.join('; ');
	},

	prefersHtml(request) {
		const accept = request.headers.get('accept') || '';
		return accept.includes('text/html');
	},

	createUnauthorizedResponse(request) {
		if (this.prefersHtml(request)) {
			return new Response(this.generateLoginPage(), {
				status: 401,
				headers: {
					'content-type': 'text/html;charset=UTF-8',
					'cache-control': 'no-store',
				},
			});
		}

		return this.createErrorResponse('未授权访问，请先登录', 401);
	},

	createAuthConfigResponse(request) {
		const message = '未配置访问密码，请设置 ACCESS_PASSWORD';

		if (this.prefersHtml(request)) {
			return new Response(this.generateAuthConfigPage(message), {
				status: 500,
				headers: {
					'content-type': 'text/html;charset=UTF-8',
					'cache-control': 'no-store',
				},
			});
		}

		return this.createErrorResponse(message, 500);
	},

	/**
	 * HTML 转义
	 * @param {string} value
	 * @returns {string}
	 */
	escapeHtml(value) {
		return String(value ?? '').replace(/[&<>"']/g, function(char) {
			return {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
			}[char];
		});
	},

	// ==================== 前端页面生成 ====================

	/**
	 * 生成首页HTML
	 * @param {Object} fileList - 文件列表
	 * @returns {string} HTML内容
	 */
	generateLoginPage() {
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>FileFlow 登录</title>
				<style>
					* { box-sizing: border-box; }
					body {
						margin: 0;
						min-height: 100vh;
						display: flex;
						align-items: center;
						justify-content: center;
						padding: 20px;
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
						background: linear-gradient(135deg, #f0f4ff, #f7f9fc);
						color: #1f2937;
					}
					.login-card {
						width: 100%;
						max-width: 360px;
						background: #fff;
						border-radius: 16px;
						padding: 28px 24px;
						box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
					}
					h1 {
						margin: 0 0 10px;
						font-size: 28px;
						text-align: center;
					}
					p {
						margin: 0 0 20px;
						color: #6b7280;
						text-align: center;
						line-height: 1.5;
					}
					label {
						display: block;
						margin-bottom: 8px;
						font-size: 14px;
						font-weight: 600;
					}
					input {
						width: 100%;
						padding: 12px 14px;
						border: 1px solid #d0d7de;
						border-radius: 10px;
						font-size: 15px;
					}
					input:focus {
						outline: none;
						border-color: #2563eb;
						box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
					}
					button {
						width: 100%;
						margin-top: 14px;
						padding: 12px 14px;
						border: none;
						border-radius: 10px;
						background: #2563eb;
						color: #fff;
						font-size: 15px;
						font-weight: 600;
						cursor: pointer;
					}
					button:hover {
						background: #1d4ed8;
					}
					.message {
						margin-top: 14px;
						padding: 10px 12px;
						border-radius: 10px;
						font-size: 14px;
						display: none;
					}
					.message.error {
						background: #fef2f2;
						color: #b91c1c;
					}
					.tip {
						margin-top: 12px;
						font-size: 12px;
						color: #94a3b8;
						text-align: center;
					}
				</style>
			</head>
			<body>
				<div class="login-card">
					<h1>FileFlow</h1>
					<p>请输入访问密码后继续使用文件和剪贴板功能。</p>
					<form id="loginForm">
						<label for="password">访问密码</label>
						<input id="password" type="password" autocomplete="current-password" placeholder="请输入密码" required>
						<button type="submit">登录</button>
					</form>
					<div id="loginMessage" class="message error"></div>
					<div class="tip">登录成功后会保存 7 天登录态。</div>
				</div>
				<script>
					const form = document.getElementById('loginForm');
					const passwordInput = document.getElementById('password');
					const message = document.getElementById('loginMessage');

					function showError(text) {
						message.style.display = 'block';
						message.textContent = text;
					}

					form.addEventListener('submit', async function(event) {
						event.preventDefault();
						message.style.display = 'none';
						const password = passwordInput.value.trim();

						if (!password) {
							showError('请输入访问密码');
							return;
						}

						try {
							const response = await fetch('/auth/login', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ password })
							});
							const result = await response.json().catch(() => ({}));

							if (!response.ok || !result.success) {
								throw new Error(result.error || '登录失败');
							}

							window.location.replace('/');
						} catch (error) {
							showError(error.message || '登录失败');
						}
					});

					passwordInput.focus();
				</script>
			</body>
			</html>
		`;
	},

	generateAuthConfigPage(message) {
		const escapedMessage = this.escapeHtml(message);
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>FileFlow 配置错误</title>
				<style>
					body {
						margin: 0;
						min-height: 100vh;
						display: flex;
						align-items: center;
						justify-content: center;
						padding: 20px;
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
						background: #f8fafc;
						color: #1f2937;
					}
					.panel {
						max-width: 560px;
						background: #fff;
						border-radius: 14px;
						padding: 24px;
						box-shadow: 0 16px 36px rgba(15, 23, 42, 0.1);
					}
					h1 { margin-top: 0; }
					code {
						background: #f1f5f9;
						padding: 2px 6px;
						border-radius: 6px;
					}
					pre {
						margin: 14px 0 0;
						padding: 14px;
						border-radius: 10px;
						background: #0f172a;
						color: #e2e8f0;
						overflow: auto;
					}
				</style>
			</head>
			<body>
				<div class="panel">
					<h1>FileFlow 未完成鉴权配置</h1>
					<p>${escapedMessage}</p>
					<p>本地开发可在 <code>.dev.vars</code> 中添加：</p>
					<pre>ACCESS_PASSWORD=your-password</pre>
					<p>部署到 Cloudflare 前请执行：</p>
					<pre>wrangler secret put ACCESS_PASSWORD</pre>
				</div>
			</body>
			</html>
		`;
	},

	generateHomePage(fileList) {
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>文件管理系统</title>
				<style>
					/* 基础样式 */
					* { box-sizing: border-box; }
					body {
						font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
						max-width: 800px;
						margin: 0 auto;
						padding: 20px;
						background: #f0f2f5;
						color: #333;
					}
					h1 {
						text-align: center;
						margin-bottom: 24px;
						font-size: 24px;
					}
					.page-header {
						display: flex;
						align-items: center;
						justify-content: space-between;
						gap: 12px;
						margin-bottom: 24px;
					}
					.page-header h1 {
						margin: 0;
						flex: 1;
						text-align: center;
					}
					.logout-btn {
						border: none;
						border-radius: 999px;
						padding: 8px 14px;
						background: #111827;
						color: #fff;
						cursor: pointer;
						font-size: 13px;
						white-space: nowrap;
					}
					.logout-btn:hover {
						background: #1f2937;
					}

					/* Tab 样式 */
					.tabs {
						display: flex;
						border-bottom: 2px solid #e0e0e0;
						margin-bottom: 0;
					}
					.tab-btn {
						flex: 1;
						padding: 12px 0;
						background: none;
						border: none;
						border-bottom: 3px solid transparent;
						margin-bottom: -2px;
						font-size: 16px;
						font-weight: 600;
						color: #888;
						cursor: pointer;
						transition: all 0.2s;
					}
					.tab-btn:hover {
						color: #333;
						background: #f5f5f5;
					}
					.tab-btn.active {
						color: #0066cc;
						border-bottom-color: #0066cc;
					}
					.tab-panel {
						display: none;
						background: #fff;
						border-radius: 0 0 8px 8px;
						padding: 20px;
						box-shadow: 0 1px 3px rgba(0,0,0,0.08);
					}
					.tab-panel.active {
						display: block;
					}

					/* 文件列表样式 */
					.file-toolbar {
						display: flex;
						align-items: center;
						justify-content: flex-end;
						flex-wrap: wrap;
						gap: 8px;
						margin-bottom: 12px;
						font-size: 14px;
						color: #555;
					}
					.file-toolbar select {
						max-width: 100%;
						padding: 7px 10px;
						border: 1px solid #d0d0d0;
						border-radius: 4px;
						background: #fff;
						color: #333;
						font: inherit;
					}
					.file-list {
						list-style: none;
						padding: 0;
						margin: 0;
					}
					.file-item {
						padding: 10px 0;
						border-bottom: 1px solid #f0f0f0;
						display: flex;
						justify-content: space-between;
						align-items: center;
						gap: 12px;
					}
					.file-item:last-child {
						border-bottom: none;
					}
					.file-details {
						flex: 1;
						min-width: 0;
					}
					.file-date {
						display: block;
						margin-top: 4px;
						font-size: 12px;
						line-height: 1.5;
						color: #777;
					}
					.file-item a {
						color: #0066cc;
						text-decoration: none;
						word-break: break-all;
						overflow-wrap: anywhere;
						line-height: 1.5;
						flex: 1;
						min-width: 0;
					}
					.file-item a:hover {
						text-decoration: underline;
					}
					.file-item .delete-btn {
						flex-shrink: 0;
					}
					.delete-btn,
					.copy-btn,
					.edit-btn {
						border: none;
						padding: 5px 10px;
						border-radius: 4px;
						cursor: pointer;
						font-size: 13px;
						white-space: nowrap;
						line-height: 1.4;
						min-height: 30px;
						display: inline-flex;
						align-items: center;
						justify-content: center;
					}
					.delete-btn {
						background: #dc3545;
						color: white;
					}
					.delete-btn:hover {
						background: #c82333;
					}
					.no-files {
						color: #999;
						font-style: italic;
						text-align: center;
						padding: 20px 0;
					}

					/* 上传区域样式 */
					.upload-form {
						margin-top: 20px;
						padding: 16px;
						background: #f9f9f9;
						border-radius: 6px;
					}
					.upload-form h3 {
						margin: 0 0 12px 0;
						font-size: 15px;
						color: #555;
					}
					.upload-area {
						border: 2px dashed #d0d0d0;
						border-radius: 6px;
						padding: 24px;
						text-align: center;
						background: #fff;
						cursor: pointer;
						transition: all 0.2s;
					}
					.upload-area:hover, .upload-area.dragover {
						border-color: #0066cc;
						background: #f0f7ff;
					}
					.upload-area p {
						margin: 0;
						color: #888;
						font-size: 14px;
					}
					.upload-area .icon {
						font-size: 40px;
						margin-bottom: 8px;
					}
					.file-input {
						display: none;
					}
					.upload-form button[type="submit"] {
						background: #0066cc;
						color: white;
						border: none;
						padding: 8px 20px;
						border-radius: 4px;
						cursor: pointer;
						font-size: 14px;
						margin-top: 10px;
					}
					.upload-form button[type="submit"]:hover {
						background: #0052a3;
					}

					/* 消息提示样式 */
					.message {
						padding: 10px;
						margin: 10px 0;
						border-radius: 4px;
						font-size: 14px;
					}
					.success {
						background: #d4edda;
						color: #155724;
					}
					.error {
						background: #f8d7da;
						color: #721c24;
					}

					/* 进度条样式 */
					.progress-bar {
						width: 100%;
						height: 6px;
						background-color: #f0f0f0;
						border-radius: 3px;
						overflow: hidden;
						display: none;
						margin-top: 8px;
					}
					.progress-bar-fill {
						height: 100%;
						background-color: #4CAF50;
						width: 0%;
						transition: width 0.3s ease-in-out;
					}

					/* 文件预览样式 */
					.file-preview {
						margin-top: 10px;
						display: flex;
						flex-wrap: wrap;
						gap: 8px;
					}
					.file-preview-item {
						background: #fff;
						padding: 4px 10px;
						border-radius: 4px;
						border: 1px solid #e0e0e0;
						display: flex;
						align-items: center;
						gap: 6px;
						font-size: 13px;
					}
					.file-preview-item .remove {
						color: #dc3545;
						cursor: pointer;
						font-weight: bold;
					}

					/* 剪贴板样式 */
					.note-form textarea {
						width: 100%;
						resize: vertical;
						padding: 10px;
						font-size: 14px;
						border: 1px solid #ddd;
						border-radius: 4px;
						font-family: inherit;
					}
					.note-form textarea:focus {
						outline: none;
						border-color: #0066cc;
					}
					.note-form-footer {
						display: flex;
						justify-content: space-between;
						align-items: center;
						margin-top: 8px;
						gap: 10px;
						flex-wrap: wrap;
					}
					.note-form-footer span {
						color: #999;
						font-size: 13px;
					}
					.note-form-actions {
						display: flex;
						gap: 8px;
						margin-left: auto;
						flex-wrap: wrap;
						justify-content: flex-end;
					}
					.note-form-footer button {
						background: #28a745;
						color: white;
						border: none;
						padding: 6px 18px;
						border-radius: 4px;
						cursor: pointer;
						font-size: 14px;
					}
					.note-form-footer button:hover {
						background: #218838;
					}
					.note-form-footer .secondary-btn {
						background: #6c757d;
					}
					.note-form-footer .secondary-btn:hover {
						background: #5a6268;
					}
					.note-item {
						background: #f9f9f9;
						border-radius: 6px;
						padding: 10px 14px;
						margin-bottom: 8px;
						border: 1px solid #eee;
						display: flex;
						justify-content: space-between;
						align-items: flex-start;
						gap: 12px;
					}
					.note-content {
						white-space: pre-wrap;
						word-break: break-all;
						overflow-wrap: anywhere;
						flex: 1;
						min-width: 0;
						font-size: 14px;
						line-height: 1.6;
						max-height: 168px;
						overflow: auto;
						padding-right: 4px;
						scrollbar-width: thin;
						scrollbar-color: #d0d7de transparent;
					}
					.note-content::-webkit-scrollbar {
						width: 6px;
					}
					.note-content::-webkit-scrollbar-thumb {
						background: #d0d7de;
						border-radius: 999px;
					}
					.note-meta {
						display: flex;
						flex-direction: column;
						align-items: flex-end;
						gap: 4px;
						flex-shrink: 0;
					}
					.note-time {
						color: #aaa;
						font-size: 12px;
					}
					.note-actions {
						display: flex;
						gap: 6px;
						flex-wrap: wrap;
						justify-content: flex-end;
					}
					.copy-btn {
						background: #007bff;
						color: white;
					}
					.copy-btn:hover {
						background: #0056b3;
					}
					.edit-btn {
						background: #fd7e14;
						color: white;
					}
					.edit-btn:hover {
						background: #e46f0d;
					}

					@media (max-width: 640px) {
						body {
							padding: 12px;
						}
						h1 {
							margin-bottom: 16px;
							font-size: 22px;
						}
						.tab-btn {
							padding: 10px 0;
							font-size: 15px;
						}
						.tab-panel {
							padding: 16px;
							border-radius: 0 0 6px 6px;
						}
						.upload-form {
							padding: 14px;
						}
						.upload-area {
							padding: 18px 14px;
						}
						.file-item,
						.note-item,
						.note-form-footer {
							flex-direction: column;
							align-items: flex-start;
						}
						.file-details,
						.note-meta {
							width: 100%;
						}
						.file-item .delete-btn,
						.note-form-actions {
							align-self: flex-end;
						}
						.note-form-actions {
							margin-left: 0;
							width: 100%;
						}
						.note-meta {
							align-items: stretch;
						}
						.note-actions {
							width: 100%;
						}
						.note-time {
							text-align: right;
						}
					}
				</style>
			</head>
			<body>
				<div class="page-header">
					<div style="width:72px;"></div>
					<h1>FileFlow</h1>
					<button type="button" class="logout-btn" id="logoutBtn">退出登录</button>
				</div>

				<!-- Tab 导航 -->
				<div class="tabs">
					<button type="button" class="tab-btn active" data-tab="files" onclick="switchTab('files')">文件管理</button>
					<button type="button" class="tab-btn" data-tab="clipboard" onclick="switchTab('clipboard')">剪贴板</button>
				</div>

				<!-- 文件管理 Tab -->
				<div class="tab-panel active" id="tab-files">
					<div class="file-toolbar">
						<label for="fileSort">排序</label>
						<select id="fileSort">
							<option value="date-desc">上传日期：从新到旧</option>
							<option value="date-asc">上传日期：从旧到新</option>
							<option value="name-asc">文件名：升序</option>
							<option value="name-desc">文件名：降序</option>
						</select>
					</div>
					<div id="fileList">
						<p class="no-files">正在加载文件...</p>
					</div>

					<div class="upload-form">
						<h3>上传文件</h3>
						<form id="uploadForm">
							<div class="upload-area" id="dropZone">
								<div class="icon">📁</div>
								<p>拖拽文件到这里或点击选择文件</p>
								<p style="font-size:12px;margin-top:4px;">（也支持粘贴文件上传）</p>
								<input type="file" name="files" multiple class="file-input" id="fileInput">
							</div>
							<div class="file-preview" id="filePreview"></div>
							<button type="submit">上传</button>
						</form>
						<div id="uploadStatus"></div>
						<div class="progress-bar">
							<div class="progress-bar-fill"></div>
						</div>
					</div>
				</div>

				<!-- 剪贴板 Tab -->
				<div class="tab-panel" id="tab-clipboard">
					<form id="noteForm" class="note-form">
						<textarea id="noteInput" rows="3" placeholder="在这里输入或粘贴内容，然后点击保存..."></textarea>
						<div class="note-form-footer">
							<span id="noteTip">支持粘贴文本，保存后自动刷新</span>
							<div class="note-form-actions">
								<button type="button" id="noteCancelBtn" class="secondary-btn" style="display:none;">取消</button>
								<button type="submit" id="noteSubmitBtn">保存</button>
							</div>
						</div>
					</form>
					<div id="noteStatus"></div>
					<div id="noteList" style="margin-top:12px;"></div>
				</div>

				<script>
					// ==================== Tab 切换 ====================
					const TAB_STORAGE_KEY = 'fileflow.activeTab';
					const AVAILABLE_TABS = new Set(['files', 'clipboard']);

					function getSavedTab() {
						try {
							const savedTab = localStorage.getItem(TAB_STORAGE_KEY);
							return AVAILABLE_TABS.has(savedTab) ? savedTab : 'files';
						} catch (error) {
							return 'files';
						}
					}

					function switchTab(tab) {
						const nextTab = AVAILABLE_TABS.has(tab) ? tab : 'files';
						document.querySelectorAll('.tab-btn').forEach(btn => {
							btn.classList.toggle('active', btn.dataset.tab === nextTab);
						});
						document.querySelectorAll('.tab-panel').forEach(panel => {
							panel.classList.toggle('active', panel.id === 'tab-' + nextTab);
						});
						try {
							localStorage.setItem(TAB_STORAGE_KEY, nextTab);
						} catch (error) {
							console.warn('保存页签状态失败:', error);
						}
					}

					// ==================== 文件列表管理 ====================
					const FILE_SORT_STORAGE_KEY = 'fileflow.fileSort';
					const fileSort = document.getElementById('fileSort');
					const fileNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
					let currentFiles = ${JSON.stringify(fileList.keys).replace(/</g, '\\u003c')};

					try {
						const savedSort = localStorage.getItem(FILE_SORT_STORAGE_KEY);
						if (Array.from(fileSort.options).some(option => option.value === savedSort)) {
							fileSort.value = savedSort;
						}
					} catch (error) {
						console.warn('读取文件排序设置失败:', error);
					}

					fileSort.addEventListener('change', function() {
						try {
							localStorage.setItem(FILE_SORT_STORAGE_KEY, fileSort.value);
						} catch (error) {
							console.warn('保存文件排序设置失败:', error);
						}
						renderFileList(currentFiles);
					});

					function getUploadTime(file) {
						const value = file.metadata && file.metadata.uploadedAt;
						return typeof value === 'number' && Number.isFinite(new Date(value).getTime()) ? value : null;
					}

					function compareFiles(a, b) {
						const nameOrder = fileNameCollator.compare(a.name, b.name);
						if (fileSort.value === 'name-asc') return nameOrder;
						if (fileSort.value === 'name-desc') return -nameOrder;
						const aTime = getUploadTime(a);
						const bTime = getUploadTime(b);
						// 历史文件没有上传日期，按日期排序时始终放在末尾。
						if (aTime === null) return bTime === null ? nameOrder : 1;
						if (bTime === null) return -1;
						const timeOrder = fileSort.value === 'date-asc' ? aTime - bTime : bTime - aTime;
						return timeOrder || nameOrder;
					}

					/**
					 * 更新文件列表
					 */
					async function updateFileList() {
						try {
							const response = await fetch('/list');
							if (!response.ok) {
								const result = await response.json().catch(() => null);
								throw new Error(result && result.error ? result.error : '获取文件列表失败');
							}
							const fileList = await response.json();
							renderFileList(fileList);
						} catch (error) {
							console.error('更新文件列表失败:', error);
							document.getElementById('fileList').innerHTML = '<p class="no-files">文件列表加载失败</p>';
						}
					}

					function renderFileList(fileList) {
						currentFiles = Array.isArray(fileList) ? fileList : [];
						const container = document.getElementById('fileList');
						if (currentFiles.length === 0) {
							container.innerHTML = '<p class="no-files">暂无文件</p>';
							return;
						}

						const list = document.createElement('ul');
						list.className = 'file-list';

						currentFiles.slice().sort(compareFiles).forEach(file => {
							const fileName = String(file && file.name ? file.name : '');
							const item = document.createElement('li');
							item.className = 'file-item';

							const link = document.createElement('a');
							link.href = '/' + encodeURIComponent(fileName);
							link.title = fileName;
							link.textContent = fileName;

							const details = document.createElement('div');
							details.className = 'file-details';
							const uploadedAt = getUploadTime(file);
							const date = document.createElement(uploadedAt === null ? 'span' : 'time');
							date.className = 'file-date';
							date.textContent = uploadedAt === null ? '上传日期未知' : '上传于 ' + formatTime(uploadedAt);
							if (uploadedAt !== null) date.dateTime = new Date(uploadedAt).toISOString();
							details.appendChild(link);
							details.appendChild(date);

							const button = document.createElement('button');
							button.type = 'button';
							button.className = 'delete-btn';
							button.textContent = '删除';
							button.addEventListener('click', function() {
								deleteFile(fileName);
							});

							item.appendChild(details);
							item.appendChild(button);
							list.appendChild(item);
						});

						container.replaceChildren(list);
					}

					/**
					 * 删除文件
					 * @param {string} fileName - 要删除的文件名
					 */
					async function deleteFile(fileName) {
						if (!confirm('确定要删除文件 "' + fileName + '" 吗？')) {
							return;
						}

						try {
							const response = await fetch('/delete/' + encodeURIComponent(fileName), {
								method: 'DELETE'
							});

							if (response.ok) {
								alert('文件删除成功！');
								await updateFileList();
							} else {
								throw new Error('删除失败');
							}
						} catch (error) {
							alert('删除文件失败：' + error.message);
						}
					}

					// ==================== 文件上传管理 ====================

					// 上传相关DOM元素
					const dropZone = document.getElementById('dropZone');
					const fileInput = document.getElementById('fileInput');
					const filePreview = document.getElementById('filePreview');
					let selectedFiles = new Map(); // 存储文件名和文件对象的映射
					let pasteTipTimeout = null; // 粘贴提示定时器

					/**
					 * 处理文件选择
					 * @param {FileList|Array<File>} files - 选择的文件列表
					 */
					function handleFiles(files) {
						Array.from(files).forEach(file => {
							if (!selectedFiles.has(file.name)) {
								selectedFiles.set(file.name, file);
								const previewItem = document.createElement('div');
								previewItem.className = 'file-preview-item';

								const fileNameText = document.createElement('span');
								fileNameText.textContent = file.name;

								const removeButton = document.createElement('span');
								removeButton.className = 'remove';
								removeButton.innerHTML = '&times;';
								removeButton.setAttribute('role', 'button');
								removeButton.setAttribute('aria-label', '移除 ' + file.name);
								removeButton.addEventListener('click', function() {
									removeFile(file.name);
								});

								previewItem.appendChild(fileNameText);
								previewItem.appendChild(removeButton);
								filePreview.appendChild(previewItem);
							}
						});
					}

					/**
					 * 移除文件预览
					 * @param {string} fileName - 要移除的文件名
					 */
					function removeFile(fileName) {
						selectedFiles.delete(fileName);
						const items = filePreview.getElementsByClassName('file-preview-item');
						for (let item of items) {
							if (item.querySelector('span:first-child').textContent === fileName) {
								item.remove();
								break;
							}
						}
					}

					// 粘贴上传支持
					window.addEventListener('paste', function(e) {
						const items = e.clipboardData && e.clipboardData.items;
						if (!items) return;
						let hasFile = false;
						for (let i = 0; i < items.length; i++) {
							const item = items[i];
							if (item.kind === 'file') {
								hasFile = true;
								handleFiles([item.getAsFile()]);
							}
						}
						if (hasFile) {
							const statusDiv = document.getElementById('uploadStatus');
							statusDiv.innerHTML = '<div class="message">已粘贴文件，准备上传</div>';
							clearTimeout(pasteTipTimeout);
							pasteTipTimeout = setTimeout(() => { statusDiv.innerHTML = ''; }, 2000);
						}
					});

					// ==================== 事件监听器 ====================

					// 点击上传区域触发文件选择
					dropZone.addEventListener('click', () => {
						fileInput.click();
					});

					// 文件选择事件
					fileInput.addEventListener('change', (e) => {
						handleFiles(e.target.files);
					});

					// 拖拽相关事件
					dropZone.addEventListener('dragover', (e) => {
						e.preventDefault();
						dropZone.classList.add('dragover');
					});

					dropZone.addEventListener('dragleave', () => {
						dropZone.classList.remove('dragover');
					});

					dropZone.addEventListener('drop', (e) => {
						e.preventDefault();
						dropZone.classList.remove('dragover');
						handleFiles(e.dataTransfer.files);
					});

					// 表单提交事件
					document.getElementById('uploadForm').addEventListener('submit', async (e) => {
						e.preventDefault();
						const statusDiv = document.getElementById('uploadStatus');
						const progressBar = document.querySelector('.progress-bar');
						const progressBarFill = document.querySelector('.progress-bar-fill');

						if (selectedFiles.size === 0) {
							statusDiv.innerHTML = '<div class="message error">请选择文件</div>';
							return;
						}

						const formData = new FormData();
						selectedFiles.forEach(file => {
							formData.append('files', file);
						});

						try {
							statusDiv.innerHTML = '<div class="message">正在上传...</div>';
							progressBar.style.display = 'block';
							progressBarFill.style.width = '0%';

							const response = await fetch('/upload', {
								method: 'POST',
								body: formData
							});

							const result = await response.json();

							if (response.ok && result.success) {
								const successCount = result.results.filter(r => r.success).length;
								const failCount = result.results.length - successCount;
								
								let message = \`成功上传 \${successCount} 个文件\`;
								if (failCount > 0) {
									message += \`，\${failCount} 个文件上传失败\`;
								}
								
								statusDiv.innerHTML = '<div class="message success">' + message + '</div>';
								progressBarFill.style.width = '100%';
								
								// 清空文件输入和预览
								fileInput.value = '';
								filePreview.innerHTML = '';
								selectedFiles.clear();
								
								// 更新文件列表
								await updateFileList();
							} else {
								throw new Error(result.error || '上传失败');
							}
						} catch (error) {
							console.error('上传错误:', error);
							statusDiv.innerHTML = '<div class="message error">上传失败：' + (error.message || '未知错误') + '</div>';
						}
					});

					// ==================== 剪贴板 ====================
					async function loadNotes() {
						try {
							const res = await fetch('/note');
							if (!res.ok) {
								const result = await res.json().catch(() => null);
								throw new Error(result && result.error ? result.error : '剪贴内容加载失败');
							}
							const notes = await res.json();
							const noteList = document.getElementById('noteList');
							if (!Array.isArray(notes)) {
								throw new Error('剪贴内容格式错误');
							}
							if (!notes.length) {
								noteList.innerHTML = '<div style="color:#888;font-style:italic;">暂无剪贴内容</div>';
								return;
							}
							noteList.innerHTML = notes.map(note => \`
								<div class="note-item">
									<div class="note-content">\${escapeHtml(note.content)}</div>
									<div class="note-meta">
										<div class="note-time">\${getNoteTimeLabel(note)}</div>
										<div class="note-actions">
											<button class="delete-btn" data-note-key="\${encodeURIComponent(note.key)}" onclick="deleteNoteFromButton(this)">删除</button>
											<button class="edit-btn" data-note-key="\${encodeURIComponent(note.key)}" data-note-content="\${encodeURIComponent(note.content || '')}" onclick="startEditNote(this)">编辑</button>
											<button class="copy-btn" data-note-content="\${encodeURIComponent(note.content || '')}" onclick="copyNoteContent(this)">复制</button>
										</div>
									</div>
								</div>
							\`).join('');
						} catch (e) {
							document.getElementById('noteList').innerHTML = '<div style="color:#c00;">' + escapeHtml(e.message || '剪贴内容加载失败') + '</div>';
						}
					}

					function escapeHtml(str) {
						return str.replace(/[&<>"']/g, function(c) {
							return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
						});
					}

					function formatTime(ts) {
						const d = new Date(ts);
						return d.getFullYear() + '-' + (d.getMonth()+1).toString().padStart(2,'0') + '-' + d.getDate().toString().padStart(2,'0') + ' ' + d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0');
					}

					function getNoteTimeLabel(note) {
						if (note.updatedTime && note.updatedTime !== note.time) {
							return '已编辑 · ' + formatTime(note.updatedTime);
						}
						return formatTime(note.time);
					}

					const noteForm = document.getElementById('noteForm');
					const noteInput = document.getElementById('noteInput');
					const noteStatus = document.getElementById('noteStatus');
					const noteTip = document.getElementById('noteTip');
					const noteSubmitBtn = document.getElementById('noteSubmitBtn');
					const noteCancelBtn = document.getElementById('noteCancelBtn');
					let editingNoteKey = null;

					function resetNoteForm() {
						editingNoteKey = null;
						noteForm.reset();
						noteSubmitBtn.innerText = '保存';
						noteTip.innerText = '支持粘贴文本，保存后自动刷新';
						noteCancelBtn.style.display = 'none';
					}

					function startEditNote(btn) {
						editingNoteKey = decodeURIComponent(btn.dataset.noteKey || '');
						noteInput.value = decodeURIComponent(btn.dataset.noteContent || '');
						noteSubmitBtn.innerText = '更新';
						noteTip.innerText = '正在编辑这条剪贴内容';
						noteCancelBtn.style.display = 'inline-flex';
						switchTab('clipboard');
						noteInput.focus();
						noteInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
					}

					// 剪贴内容表单提交
					noteForm.addEventListener('submit', async function(e) {
						e.preventDefault();
						const content = noteInput.value.trim();
						const isEditing = !!editingNoteKey;
						if (!content) {
							noteStatus.innerHTML = '<div class="message error">内容不能为空</div>';
							return;
						}
						noteStatus.innerHTML = '<div class="message">' + (isEditing ? '正在更新...' : '正在保存...') + '</div>';
						try {
							const res = await fetch(isEditing ? '/note/update/' + encodeURIComponent(editingNoteKey) : '/note', {
								method: isEditing ? 'PUT' : 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ content })
							});
							const result = await res.json();
							if (res.ok && result.success) {
								noteStatus.innerHTML = '<div class="message success">' + (isEditing ? '更新成功！' : '保存成功！') + '</div>';
								resetNoteForm();
								await loadNotes();
							} else {
								throw new Error(result.error || (isEditing ? '更新失败' : '保存失败'));
							}
						} catch (err) {
							noteStatus.innerHTML = '<div class="message error">' + (isEditing ? '更新失败：' : '保存失败：') + (err.message || '未知错误') + '</div>';
						}
						setTimeout(() => { noteStatus.innerHTML = ''; }, 2000);
					});

					noteCancelBtn.addEventListener('click', function() {
						resetNoteForm();
					});

					// 支持粘贴文本到输入框
					noteInput.addEventListener('paste', function(e) {
						noteTip.innerText = editingNoteKey ? '已粘贴内容，可直接更新' : '已粘贴内容，可直接保存';
						setTimeout(() => {
							noteTip.innerText = editingNoteKey ? '正在编辑这条剪贴内容' : '支持粘贴文本，保存后自动刷新';
						}, 2000);
					});

					// 删除剪贴内容
					async function deleteNote(key) {
						if (!confirm('确定要删除这条剪贴内容吗？')) return;
						try {
							const res = await fetch('/note/delete/' + encodeURIComponent(key), { method: 'DELETE' });
							const result = await res.json();
							if (res.ok && result.success) {
								if (editingNoteKey === key) {
									resetNoteForm();
								}
								await loadNotes();
							} else {
								throw new Error(result.error || '删除失败');
							}
						} catch (err) {
							alert('删除剪贴内容失败：' + (err.message || '未知错误'));
						}
					}

					function deleteNoteFromButton(button) {
						deleteNote(decodeURIComponent(button.dataset.noteKey || ''));
					}

					window.deleteNoteFromButton = deleteNoteFromButton;

					function fallbackCopyText(content) {
						const textarea = document.createElement('textarea');
						textarea.value = content;
						textarea.setAttribute('readonly', 'readonly');
						textarea.style.position = 'fixed';
						textarea.style.top = '-9999px';
						document.body.appendChild(textarea);
						textarea.select();
						const success = document.execCommand('copy');
						textarea.remove();
						if (!success) {
							throw new Error('浏览器不支持自动复制');
						}
					}

					// 一键复制内容
					async function copyNoteContent(btn) {
						try {
							const encodedContent = btn.dataset.noteContent || '';
							const content = decodeURIComponent(encodedContent);
							if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
								await navigator.clipboard.writeText(content);
							} else {
								fallbackCopyText(content);
							}
							btn.innerText = '已复制';
							btn.style.background = '#28a745';
							setTimeout(() => {
								btn.innerText = '复制';
								btn.style.background = '#007bff';
							}, 1200);
						} catch (err) {
							alert('复制失败：' + (err.message || '未知错误'));
						}
					}

					// 页面加载时自动加载剪贴内容
					const logoutBtn = document.getElementById('logoutBtn');
					logoutBtn.addEventListener('click', async function() {
						if (!confirm('确定要退出登录吗？')) {
							return;
						}

						try {
							await fetch('/auth/logout', { method: 'POST' });
						} finally {
							window.location.replace('/');
						}
					});

					renderFileList(currentFiles);
					switchTab(getSavedTab());
					loadNotes();
				</script>
			</body>
			</html>
		`;
	}
};
