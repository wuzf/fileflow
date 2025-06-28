import { describe, expect, it } from 'vitest';
import worker from '../src';

const ACCESS_PASSWORD = 'test-password';

function createKvNamespace(initialEntries = []) {
	const store = new Map(initialEntries);

	return {
		async list() {
			return {
				keys: Array.from(store.keys()).map(name => ({ name })),
			};
		},
		async get(key, options = {}) {
			if (!store.has(key)) {
				return null;
			}

			const value = store.get(key);
			if (options.type === 'json') {
				return JSON.parse(value);
			}

			return value;
		},
		async put(key, value) {
			store.set(key, value);
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
