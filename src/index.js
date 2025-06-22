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
			const fileList = await env.FILE.list();
			return new Response(this.generateHomePage(fileList), {
				headers: {
					'content-type': 'text/html;charset=UTF-8',
				},
			});
		} catch (error) {
			return this.createErrorResponse('获取文件列表失败', 500);
		}
	},

	/**
	 * 处理文件列表API请求
	 * @param {Object} env - 环境变量
	 * @returns {Response} JSON响应
	 */
	async handleFileList(env) {
		try {
			const fileList = await env.FILE.list();
			return new Response(JSON.stringify(fileList.keys), {
				headers: {
					'content-type': 'application/json',
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
					await env.FILE.put(file.name, fileBuffer);
					results.push({
						name: file.name,
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
			// 按时间倒序
			notes.sort((a, b) => b.time - a.time);
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

	// ==================== 前端页面生成 ====================

	/**
	 * 生成首页HTML
	 * @param {Object} fileList - 文件列表
	 * @returns {string} HTML内容
	 */
	generateHomePage(fileList) {
		return `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="UTF-8">
				<title>文件管理系统</title>
				<style>
					/* 基础样式 */
					body {
						font-family: Arial, sans-serif;
						max-width: 800px;
						margin: 0 auto;
						padding: 20px;
					}

					/* 文件列表样式 */
					.file-list {
						list-style: none;
						padding: 0;
					}
					.file-item {
						padding: 10px;
						border-bottom: 1px solid #eee;
						display: flex;
						justify-content: space-between;
						align-items: center;
					}
					.file-item a {
						color: #0066cc;
						text-decoration: none;
					}
					.file-item a:hover {
						text-decoration: underline;
					}
					.delete-btn {
						background: #dc3545;
						color: white;
						border: none;
						padding: 5px 10px;
						border-radius: 3px;
						cursor: pointer;
					}
					.delete-btn:hover {
						background: #c82333;
					}
					.no-files {
						color: #666;
						font-style: italic;
					}

					/* 上传区域样式 */
					.upload-form {
						margin: 20px 0;
						padding: 20px;
						background: #f5f5f5;
						border-radius: 5px;
					}
					.upload-area {
						border: 2px dashed #ccc;
						border-radius: 5px;
						padding: 20px;
						text-align: center;
						margin: 10px 0;
						background: #fff;
						cursor: pointer;
						transition: all 0.3s ease;
					}
					.upload-area:hover, .upload-area.dragover {
						border-color: #0066cc;
						background: #f0f7ff;
					}
					.upload-area p {
						margin: 0;
						color: #666;
					}
					.upload-area .icon {
						font-size: 48px;
						color: #ccc;
						margin-bottom: 10px;
					}
					.file-input {
						display: none;
					}
					.upload-form button {
						background: #0066cc;
						color: white;
						border: none;
						padding: 10px 20px;
						border-radius: 5px;
						cursor: pointer;
					}
					.upload-form button:hover {
						background: #0052a3;
					}

					/* 消息提示样式 */
					.message {
						padding: 10px;
						margin: 10px 0;
						border-radius: 5px;
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
						height: 20px;
						background-color: #f0f0f0;
						border-radius: 10px;
						overflow: hidden;
						display: none;
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
						gap: 10px;
					}
					.file-preview-item {
						background: #fff;
						padding: 5px 10px;
						border-radius: 3px;
						border: 1px solid #ddd;
						display: flex;
						align-items: center;
						gap: 5px;
					}
					.file-preview-item .remove {
						color: #dc3545;
						cursor: pointer;
						font-weight: bold;
					}
				</style>
			</head>
			<body>
				<h1>文件管理系统</h1>

				<!-- 文件列表区域 -->
				<h2>文件列表</h2>
				<div id="fileList">
					${fileList.keys.length > 0 ? `
						<ul class="file-list">
							${fileList.keys.map(file => `
								<li class="file-item">
									<a href="/${file.name}">${file.name}</a>
									<button class="delete-btn" onclick="deleteFile('${file.name}')">删除</button>
								</li>
							`).join('')}
						</ul>
					` : '<p class="no-files">暂无文件</p>'}
				</div>

				<!-- 上传区域 -->
				<div class="upload-form">
					<h2>上传文件</h2>
					<form id="uploadForm">
						<div class="upload-area" id="dropZone">
							<div class="icon">📁</div>
							<p>拖拽文件到这里或点击选择文件</p>
							<p style="color:#888;font-size:13px;">（也支持粘贴文件上传）</p>
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

				<!-- 剪贴板区域（移到最后） -->
				<div class="notebook" style="margin-top:32px;padding:20px;background:#f9f9f9;border-radius:6px;">
					<h2>剪贴板</h2>
					<form id="noteForm" style="margin-bottom:10px;">
						<textarea id="noteInput" rows="3" style="width:100%;resize:vertical;padding:8px;font-size:15px;" placeholder="在这里输入或粘贴内容，然后点击保存..."></textarea>
						<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
							<span id="noteTip" style="color:#888;font-size:13px;">支持粘贴文本，保存后自动刷新</span>
							<button type="submit" style="background:#28a745;color:white;border:none;padding:6px 18px;border-radius:4px;cursor:pointer;">保存</button>
						</div>
					</form>
					<div id="noteStatus"></div>
					<div id="noteList" style="margin-top:10px;"></div>
				</div>

				<script>
					// ==================== 文件列表管理 ====================
					
					/**
					 * 更新文件列表
					 */
					async function updateFileList() {
						try {
							const response = await fetch('/list');
							const fileList = await response.json();
							const fileListHtml = fileList.length > 0 
								? \`<ul class="file-list">
									\${fileList.map(file => \`
										<li class="file-item">
											<a href="/\${file.name}">\${file.name}</a>
											<button class="delete-btn" onclick="deleteFile('\${file.name}')">删除</button>
										</li>
									\`).join('')}
								</ul>\`
								: '<p class="no-files">暂无文件</p>';
							document.getElementById('fileList').innerHTML = fileListHtml;
						} catch (error) {
							console.error('更新文件列表失败:', error);
						}
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
								previewItem.innerHTML = \`
									<span>\${file.name}</span>
									<span class="remove" onclick="removeFile('\${file.name}')">&times;</span>
								\`;
								filePreview.appendChild(previewItem);
							}
						});
					}

					/**
					 * 移除文件预览
					 * @param {string} fileName - 要移除的文件名
					 */
					window.removeFile = function(fileName) {
						selectedFiles.delete(fileName);
						const items = filePreview.getElementsByClassName('file-preview-item');
						for (let item of items) {
							if (item.querySelector('span:first-child').textContent === fileName) {
								item.remove();
								break;
							}
						}
					};

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
							const notes = await res.json();
							const noteList = document.getElementById('noteList');
							if (!notes.length) {
								noteList.innerHTML = '<div style="color:#888;font-style:italic;">暂无剪贴内容</div>';
								return;
							}
							noteList.innerHTML = notes.map(note => \`
								<div style="background:#fff;border-radius:4px;padding:8px 12px;margin-bottom:8px;border:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
									<div style="white-space:pre-wrap;word-break:break-all;max-width:70%;">\${escapeHtml(note.content)}</div>
									<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
										<div style="color:#aaa;font-size:12px;">\${formatTime(note.time)}</div>
										<div style="display:flex;gap:6px;">
											<button class="delete-btn" style="padding:2px 10px;font-size:13px;" onclick="deleteNote('\${note.key}')">删除</button>
											<button class="delete-btn" style="background:#007bff;margin-left:0;padding:2px 10px;font-size:13px;" onclick="copyNoteContent(this, '\${escapeHtml(note.content)}')">复制</button>
										</div>
									</div>
								</div>
							\`).join('');
						} catch (e) {
							document.getElementById('noteList').innerHTML = '<div style="color:#c00;">剪贴内容加载失败</div>';
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

					// 剪贴内容表单提交
					document.getElementById('noteForm').addEventListener('submit', async function(e) {
						e.preventDefault();
						const input = document.getElementById('noteInput');
						const status = document.getElementById('noteStatus');
						const content = input.value.trim();
						if (!content) {
							status.innerHTML = '<div class="message error">内容不能为空</div>';
							return;
						}
						status.innerHTML = '<div class="message">正在保存...</div>';
						try {
							const res = await fetch('/note', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ content })
							});
							const result = await res.json();
							if (res.ok && result.success) {
								status.innerHTML = '<div class="message success">保存成功！</div>';
								input.value = '';
								await loadNotes();
							} else {
								throw new Error(result.error || '保存失败');
							}
						} catch (err) {
							status.innerHTML = '<div class="message error">保存失败：' + (err.message || '未知错误') + '</div>';
						}
						setTimeout(() => { status.innerHTML = ''; }, 2000);
					});

					// 支持粘贴文本到输入框
					document.getElementById('noteInput').addEventListener('paste', function(e) {
						document.getElementById('noteTip').innerText = '已粘贴内容，可直接保存';
						setTimeout(() => { document.getElementById('noteTip').innerText = '支持粘贴文本，保存后自动刷新'; }, 2000);
					});

					// 删除剪贴内容
					async function deleteNote(key) {
						if (!confirm('确定要删除这条剪贴内容吗？')) return;
						try {
							const res = await fetch('/note/delete/' + encodeURIComponent(key), { method: 'DELETE' });
							const result = await res.json();
							if (res.ok && result.success) {
								await loadNotes();
							} else {
								throw new Error(result.error || '删除失败');
							}
						} catch (err) {
							alert('删除剪贴内容失败：' + (err.message || '未知错误'));
						}
					}

					// 一键复制内容
					async function copyNoteContent(btn, content) {
						try {
							await navigator.clipboard.writeText(content.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"));
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
					loadNotes();
				</script>
			</body>
			</html>
		`;
	}
};
