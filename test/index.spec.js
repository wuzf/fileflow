import { describe, expect, it } from 'vitest';
import worker from '../src';

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

function createEnv({ files = [], notes = [] } = {}) {
	return {
		FILE: createKvNamespace(files),
		NOTE: createKvNamespace(notes),
	};
}

describe('fileflow worker', () => {
	it('renders the home page HTML', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/'),
			createEnv(),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');

		const html = await response.text();
		expect(html).toContain('FileFlow');
		expect(html).toContain('文件管理');
		expect(html).toContain('剪贴板');
	});

	it('rejects empty note content', async () => {
		const response = await worker.fetch(
			new Request('http://example.com/note', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ content: '   ' }),
			}),
			createEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: '内容不能为空' });
	});

	it('updates an existing note', async () => {
		const createdTime = 1700000000000;
		const env = createEnv({
			notes: [['note_1', JSON.stringify({ content: 'old text', time: createdTime })]],
		});

		const response = await worker.fetch(
			new Request('http://example.com/note/update/note_1', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ content: 'new text' }),
			}),
			env,
		);

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
		const response = await worker.fetch(
			new Request('http://example.com/note/update/missing', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ content: 'new text' }),
			}),
			createEnv(),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: '剪贴内容不存在' });
	});
});
