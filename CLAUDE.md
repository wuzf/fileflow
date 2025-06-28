# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FileFlow is a serverless file and clipboard management application built on Cloudflare Workers. It uses Cloudflare KV for storage and serves an embedded HTML/CSS/JS frontend from a single JavaScript file.

## Commands

- `npm run dev` — Start local dev server (http://localhost:8787)
- `npm test` — Run tests (vitest with Cloudflare Workers pool)
- `npm run deploy` — Deploy to Cloudflare Workers (requires `wrangler login`)

## Architecture

**Single-file application** (`src/index.js`, ~890 lines) containing:

1. **Fetch handler** — URL path + HTTP method routing (no framework)
2. **API handlers** — File CRUD (`/upload`, `/list`, `/delete/{name}`, `/{name}`) and clipboard notes CRUD (`/note`, `/note/delete/{key}`)
3. **Utilities** — MIME type mapping (`getContentType`), error response helper
4. **Frontend generator** — `generateHomePage()` produces the complete HTML page with inline CSS and vanilla JS (no build step, no frontend dependencies)

**Storage:** Two Cloudflare KV namespaces bound as `env.FILE` and `env.NOTE`.

**Constraints:** 100MB max file size (Cloudflare Workers limit). Chinese filenames are URI-encoded for download headers.

## Code Conventions

- JavaScript (no TypeScript), ES modules (`export default`)
- Tabs for indentation, single quotes, semicolons (see `.prettierrc`)
- Git commit messages in Chinese
- All frontend code is embedded in `generateHomePage()` as template literals — no separate HTML/CSS/JS files
