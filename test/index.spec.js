import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src';

const ACCESS_PASSWORD = 'test-password';

function createKvNamespace(initialEntries = []) {
	const store = new Map(initialEntries.map(([name, value, metadata]) => [name, { value, metadata }]));

	return {
		async list() {
			return {
				keys: Array.from(store.entries()).map(([name, entry]) => (
					entry.metadata === undefined ? { name } : { name, metadata: entry.metadata }
				)),
				list_complete: true,
			};
		},
		async get(key, options = {}) {
			if (!store.has(key)) {
				return null;
			}

			const { value } = store.get(key);
			if (options.type === 'json') {
				return JSON.parse(value);
			}

			return value;
		},
		async put(key, value, options = {}) {
			store.set(key, { value, metadata: options.metadata });
		},
		async delete(key) {
			store.delete(key);
		},
	};
}

function createEnv({ files = [], notes = [], accessPassword = ACCESS_PASSWORD } = {}) {
	return {
		FILE: createKvNamespace(files),
		NOTE: createKvNamespace(notes),
		ACCESS_PASSWORD: accessPassword,
	};
}

async function createAuthCookie(password = ACCESS_PASSWORD) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
	const token = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
	return `fileflow_auth=${token}`;
}

async function createAuthenticatedRequest(url, init = {}, password = ACCESS_PASSWORD) {
	const headers = new Headers(init.headers || {});
	headers.set('cookie', await createAuthCookie(password));
	return new Request(url, {
		...init,
		headers,
	});
}

describe('fileflow worker auth', () => {
	it('renders login page for unauthenticated browser requests', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/', {
				headers: { accept: 'text/html' },
			}),
			createEnv(),
		);

		expect(response.status).toBe(401);
		expect(response.headers.get('content-type')).toContain('text/html');

		const html = await response.text();
		expect(html).toContain('FileFlow');
		expect(html).toContain('访问密码');
	});

	it('allows unauthenticated direct file downloads', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/public.txt', {
				method: 'GET',
			}),
			createEnv({
				files: [['public.txt', 'hello world']],
			}),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-disposition')).toContain('public.txt');
		await expect(response.text()).resolves.toBe('hello world');
	});

	it('logs in with the correct password', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password: ACCESS_PASSWORD }),
			}),
			createEnv(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ success: true });
		expect(response.headers.get('set-cookie')).toContain('fileflow_auth=');
	});

	it('rejects an incorrect password', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ password: 'wrong-password' }),
			}),
			createEnv(),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ error: '密码错误' });
	});

	it('renders the home page HTML after authentication', async () => {
		const request = await createAuthenticatedRequest('http://example.com/', {
			headers: { accept: 'text/html' },
		});
		const response = await worker.fetch(request, createEnv());

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');

		const html = await response.text();
		expect(html).toContain('FileFlow');
		expect(html).toContain('退出登录');
	});
});

describe('fileflow worker file routes', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function uploadFiles(env, files) {
		const formData = new FormData();
		for (const [name, content] of files) {
			formData.append('files', new File([content], name, { type: 'text/plain' }));
		}
		const request = await createAuthenticatedRequest('http://example.com/upload', {
			method: 'POST',
			body: formData,
		});
		return worker.fetch(request, env);
	}

	it('persists the upload date for every uploaded file and returns it in the file list', async () => {
		const uploadedAt = 1700000000000;
		vi.spyOn(Date, 'now').mockReturnValue(uploadedAt);
		const env = createEnv();
		const response = await uploadFiles(env, [['report.txt', 'report'], ['notes.txt', 'notes']]);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			success: true,
			results: [
				{ name: 'report.txt', success: true, uploadedAt },
				{ name: 'notes.txt', success: true, uploadedAt },
			],
		});

		const listResponse = await worker.fetch(await createAuthenticatedRequest('http://example.com/list'), env);
		expect(listResponse.status).toBe(200);
		await expect(listResponse.json()).resolves.toEqual([
			{ name: 'report.txt', metadata: { uploadedAt } },
			{ name: 'notes.txt', metadata: { uploadedAt } },
		]);
	});

	it('updates both the upload date and contents when replacing a file with the same name', async () => {
		const originalTime = 1700000000000;
		const replacementTime = originalTime + 60000;
		const now = vi.spyOn(Date, 'now').mockReturnValue(originalTime);
		const env = createEnv();
		const originalResponse = await uploadFiles(env, [['report.txt', 'original contents']]);
		expect((await originalResponse.json()).results[0]).toEqual({
			name: 'report.txt', success: true, uploadedAt: originalTime,
		});

		now.mockReturnValue(replacementTime);
		const replacementResponse = await uploadFiles(env, [['report.txt', 'replacement contents']]);
		expect((await replacementResponse.json()).results[0]).toEqual({
			name: 'report.txt', success: true, uploadedAt: replacementTime,
		});

		const listResponse = await worker.fetch(await createAuthenticatedRequest('http://example.com/list'), env);
		await expect(listResponse.json()).resolves.toEqual([
			{ name: 'report.txt', metadata: { uploadedAt: replacementTime } },
		]);
		const downloadResponse = await worker.fetch(new Request('http://example.com/report.txt'), env);
		expect(downloadResponse.status).toBe(200);
		await expect(downloadResponse.text()).resolves.toBe('replacement contents');
	});

	it('keeps existing files without upload metadata available in the list, home page and downloads', async () => {
		const env = createEnv({ files: [['legacy.txt', 'legacy contents']] });
		const listResponse = await worker.fetch(await createAuthenticatedRequest('http://example.com/list'), env);
		expect(listResponse.status).toBe(200);
		await expect(listResponse.json()).resolves.toEqual([{ name: 'legacy.txt' }]);

		const homeResponse = await worker.fetch(await createAuthenticatedRequest('http://example.com/'), env);
		expect(homeResponse.status).toBe(200);
		expect(await homeResponse.text()).toContain('legacy.txt');

		const downloadResponse = await worker.fetch(new Request('http://example.com/legacy.txt'), env);
		expect(downloadResponse.status).toBe(200);
		await expect(downloadResponse.text()).resolves.toBe('legacy contents');
	});

	it.each(['/list', '/'])('includes all KV pages for %s, including pages after an empty page', async (path) => {
		const firstFile = { name: 'first.txt', metadata: { uploadedAt: 1700000000000 } };
		const lastFile = { name: 'last.txt', metadata: { uploadedAt: 1700000060000 } };
		const pages = {
			start: { keys: [firstFile], list_complete: false, cursor: 'empty-page' },
			'empty-page': { keys: [], list_complete: false, cursor: 'last-page' },
			'last-page': { keys: [lastFile], list_complete: true },
		};
		const env = createEnv();
		env.FILE.list = vi.fn(async (options = {}) => {
			const page = pages[options.cursor || 'start'];
			if (!page) throw new Error('Unexpected KV cursor');
			return page;
		});

		const response = await worker.fetch(await createAuthenticatedRequest('http://example.com' + path), env);
		expect(response.status).toBe(200);
		if (path === '/list') {
			await expect(response.json()).resolves.toEqual([firstFile, lastFile]);
		} else {
			const html = await response.text();
			expect(html).toContain(firstFile.name);
			expect(html).toContain(lastFile.name);
		}
		expect(env.FILE.list).toHaveBeenCalledTimes(3);
		expect(env.FILE.list.mock.calls[1][0]).toMatchObject({ cursor: 'empty-page' });
		expect(env.FILE.list.mock.calls[2][0]).toMatchObject({ cursor: 'last-page' });
	});
});

describe('fileflow worker note routes', () => {
	it('rejects unauthenticated API requests', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/note', {
				method: 'GET',
			}),
			createEnv(),
		);

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ error: '未授权访问，请先登录' });
	});

	it('rejects empty note content', async () => {
		const request = await createAuthenticatedRequest('http://example.com/note', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: '   ' }),
		});
		const response = await worker.fetch(request, createEnv());

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: '内容不能为空' });
	});

	it('updates an existing note', async () => {
		const createdTime = 1700000000000;
		const env = createEnv({
			notes: [['note_1', JSON.stringify({ content: 'old text', time: createdTime })]],
		});
		const request = await createAuthenticatedRequest('http://example.com/note/update/note_1', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: 'new text' }),
		});

		const response = await worker.fetch(request, env);

		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result.success).toBe(true);
		expect(typeof result.updatedTime).toBe('number');

		const savedNote = await env.NOTE.get('note_1', { type: 'json' });
		expect(savedNote).toEqual({
			content: 'new text',
			time: createdTime,
			updatedTime: result.updatedTime,
		});
	});

	it('returns 404 when updating a missing note', async () => {
		const request = await createAuthenticatedRequest('http://example.com/note/update/missing', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: 'new text' }),
		});
		const response = await worker.fetch(request, createEnv());

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: '剪贴内容不存在' });
	});
});
