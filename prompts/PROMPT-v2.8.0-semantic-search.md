# Jarvis v2.8.0 — Semantic Search

## Context
Obsidian Jarvis UI is a 3D knowledge graph visualizer for Obsidian vaults. Built with React + TypeScript + Three.js + d3-force-3d. Currently at v2.7.0 (presets).

**Repo:** `/home/samuel/projects/tools/obsidian-jarvis-timelapse` (worktree)
**Create branch** `feat/semantic-search` from the latest HEAD of this worktree.

## Feature: Semantic Search with Local Embeddings

Add semantic (meaning-based) search using local embeddings. No API keys, no external calls, runs entirely on the server.

### Stack
- **Library:** `@xenova/transformers` (Transformers.js) — MIT, runs in Node.js
- **Model:** `Xenova/all-MiniLM-L6-v2` — 384-dimensional embeddings, ~22MB download on first run
- Install: `npm install @xenova/transformers`

### Server-side implementation

#### 1. `server/embeddings.ts`
- `let pipeline: any = null` — lazy-load the pipeline on first use
- `async function getEmbedding(text: string): Promise<number[]>` — returns 384-dim vector
- `async function cosineSimilarity(a: number[], b: number[]): Promise<number>`
- Pipeline initialization: `const { pipeline: createPipeline } = await import('@xenova/transformers'); pipeline = await createPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')`

#### 2. Embedding cache: `~/.jarvis-embeddings.json`
Format:
```json
{
  "version": 1,
  "model": "Xenova/all-MiniLM-L6-v2",
  "entries": {
    "note-id": {
      "mtime": "2026-03-13T00:00:00Z",
      "embedding": [0.1, 0.2, ...]
    }
  }
}
```
- On server start: load cache, check each note's `mtime` — skip if unchanged, re-embed if stale
- Index build runs async in background so the server starts immediately
- Write cache to disk after build completes (and periodically during build)

#### 3. `GET /api/semantic-search?q=<query>`
- Embed the query string
- Cosine similarity against all cached note embeddings
- Return top-10 results: `[{ id, label, score, excerpt }]`
- Include a `ready` field: `false` while initial index is building, `true` when done

#### 4. `GET /api/semantic-status`
- Returns: `{ ready: boolean, indexed: number, total: number, model: string }`
- Frontend can poll this to show indexing progress

### Frontend implementation

#### 5. Search bar enhancement
- New prefix: `~` triggers semantic search mode
- When user types `~productivity`, the search bar:
  - Shows "🧠 Semantic search..." indicator
  - Calls `/api/semantic-search?q=productivity`
  - Results shown in the same dropdown as regular search, but with a "── Semantic ──" divider
  - Each result shows similarity score as a percentage badge

#### 6. Sidebar: "Similar Notes" section
- When a note is open in the sidebar, add a "Similar Notes" section at the bottom
- Calls `/api/semantic-search?q=<current note title + first 200 chars of content>`
- Shows top-5 similar notes (excluding the current note)
- Each entry: note title (clickable → navigate to that node) + similarity %
- Only shows if semantic index is ready

#### 7. HUD: Indexing status
- While index is building, show in HUD: "🧠 INDEXING: 142/476"
- Disappears once complete
- Poll `/api/semantic-status` every 2s during indexing

### Embedding strategy
- For each note, embed: `title + "\n" + first 500 chars of content` (truncate to avoid token limits)
- Title is weighted by repetition: `title + " " + title + "\n" + content_snippet`
- This gives semantic proximity to both the topic (title) and the substance (content)

### Performance considerations
- First-time index build: ~30-60s for 500 notes (model loads ~5s, then ~0.1s per note)
- Incremental updates: only re-embed changed notes (check mtime vs cache)
- Model stays loaded in memory after first use (~50MB)
- Cache file: ~2-5MB for 500 notes (384 floats × 500 = ~768KB of embeddings + metadata)

## Constraints
- No external API calls — everything runs locally
- Model downloads automatically on first use (from HuggingFace CDN)
- Don't break existing keyword search — semantic is additive (~ prefix)
- `npm run build` must be clean
- Bump version to 2.8.0 in package.json
- Atomic commits per logical unit

## Validation
1. `npm run build` — clean
2. Start server, wait for indexing to complete
3. Test: `curl "http://localhost:3001/api/semantic-search?q=productivity"` — should return results
4. Test: `curl "http://localhost:3001/api/semantic-status"` — should show `ready: true`
5. Frontend: type `~knowledge` in search bar — should show semantic results

## Completion
Write report to `/tmp/cc-jarvis-v280-completion-report.md` then run:
```bash
export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:$PATH"
WAKE_TELEGRAM_TOPIC=2397 bash ~/.openclaw/workspace/skills/claude-code-orchestrator/scripts/wake.sh "Jarvis v2.8.0 Semantic Search complete. Report at /tmp/cc-jarvis-v280-completion-report.md" now
```
