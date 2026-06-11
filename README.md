# ClawMarket Agent Matcher

AI-powered discovery for the [ClawMarket](https://clawmarketai.com) marketplace. Describe a task in
plain English and get the best-matching agent **skill** — with pricing and a direct purchase link.

Built for the **Google Cloud Agent Builder + MongoDB Atlas** hackathon.

```
User: "I need a blockchain project audit."
  → ChronoAI · Week Audit · view & purchase on ClawMarket
```

## How it works

```
Browser (chat UI)
   │  POST /api/match { query }
   ▼
Next.js API route ──► retrieve candidates
                        ├─ Atlas Vector Search ($vectorSearch)  ← primary, semantic
                        ├─ MongoDB keyword scan                  ← fallback
                        └─ live ClawMarket API                   ← fallback (still real data)
                      shortlist (top 6)
                        └─ Gemini rerank + "why" sentence        ← when GEMINI_API_KEY is set
                      → recommendation + alternatives
```

### Ranking tiers (degrades gracefully)

| Have | Retrieval | Final pick | `ranked_by` |
|---|---|---|---|
| Mongo + Gemini key + seeded vectors | Atlas Vector Search | Gemini rerank | `vector+gemini` |
| Mongo + seeded vectors (no live rerank) | Atlas Vector Search | top vector hit | `vector` |
| Gemini key, no vector index | keyword shortlist | Gemini rerank | `gemini` |
| nothing configured | live API + keyword | top keyword hit | `keyword` |

Embeddings use Google `gemini-embedding-001` (requested at 768-dim, cosine) — same `GEMINI_API_KEY`, no extra provider.
`npm run seed` generates them and auto-creates the Atlas Vector Search index (`vector_index`).

- **No mocked data.** The catalog comes from the live ClawMarket API:
  - `GET /services?page_size=200` — skills (title, description, best_for, tags, prices, agent_id)
  - `GET /agents` — agent id → name
  - Purchase link = `https://clawmarketai.com/skills/{slug}`
- **Graceful degradation.** Works with zero config (fetches the live catalog and ranks by keyword).
  Add MongoDB for the seeded-catalog path; add a Gemini key for semantic ranking + natural-language
  reasons.

> Note: the PRD references an endpoint `/agent/skills` and a demo agent "PitchAI". Neither exists in
> the live data — the real catalog lives at `/services` + `/agents`, and there is no PitchAI skill.
> For "review my investor pitch deck", the genuine best match is **Get Roasted** (its `best_for` is
> "Founders who want brutal honest feedback on their pitch or product"). Update the demo script or
> rely on the Gemini rerank to surface it.

## Quick start

```bash
npm install
cp .env.example .env      # fill in values (all optional for a first run)
npm run dev               # http://localhost:3000
```

With no `.env`, the app already works against the live catalog. To enable the full stack:

1. **Gemini** — set `GEMINI_API_KEY` (Google AI Studio). Powers both embeddings and rerank.
2. **MongoDB** — set `MONGODB_URI` (Atlas `mongodb+srv://…`, or self-hosted `mongodb://…` on your VPS),
   then seed:
   ```bash
   npm run seed
   ```
   With a Gemini key set, the seed also embeds every skill and creates the **Atlas Vector Search**
   index automatically. (Vector Search requires an Atlas cluster — M0 free tier works. On self-hosted
   Mongo the seed still loads data; retrieval falls back to keyword.)

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | no | Atlas or self-hosted Mongo. Without it, the matcher reads the live API. |
| `MONGODB_DB` | no | Database name (default `clawmarket`). |
| `MONGODB_COLLECTION` | no | Collection name (default `skills`). |
| `MONGODB_VECTOR_INDEX` | no | Atlas Vector Search index name (default `vector_index`). |
| `GEMINI_API_KEY` | no | Enables embeddings (vector search) + Gemini reranking. Without it, keyword ranking is used. |
| `GEMINI_MODEL` | no | Rerank model, default `gemini-2.5-flash`. |
| `GEMINI_EMBED_MODEL` | no | Embedding model, default `gemini-embedding-001`. |
| `CLAWMARKET_BASE_URL` | no | Default `https://clawmarketai.com`. |

**Never commit `.env`.** Only `.env.example` (blank placeholders) belongs in the public repo.

## The agent (Google ADK + MongoDB MCP)

The `agent/` directory is a [Google ADK](https://google.github.io/adk-docs/) agent
(`agent/clawmatcher/agent.py`): a Gemini `LlmAgent` whose only tool is the
**MongoDB MCP server** (`mongodb-mcp-server`, launched read-only over stdio). Given a task,
the agent loads the catalog through MCP and picks the best skill — it plans and uses a tool to
complete a task, rather than just chatting.

```
/api/agent (Next.js) ──HTTP──► adk api_server ──► clawmatcher LlmAgent (Gemini)
                                                      └─ MCPToolset → mongodb-mcp-server → Atlas
        └─ hydrates the chosen skill_id(s) from MongoDB (authoritative price + purchase URL)
```

Run it locally:

```bash
cd agent
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp clawmatcher/.env.example clawmatcher/.env   # fill in
.venv/bin/adk api_server --port 8100 .          # or: .venv/bin/python smoke_test.py "your task"
```

The agent runs on **Gemini via AI Studio** (`GOOGLE_API_KEY`) or **Vertex AI**
(`GOOGLE_GENAI_USE_VERTEXAI=TRUE` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` + ADC). Use
Vertex when the AI Studio API isn't available from your host's region.

## Deploy (VPS, behind nginx)

Two processes under a process manager (we use pm2), isolated on non-default ports:

```bash
# 1. build the UI
npm ci && npm run build

# 2. set up the agent venv
python3.12 -m venv agent/.venv && agent/.venv/bin/pip install -r agent/requirements.txt

# 3. env (not committed): /root/agent-matcher/.env and agent/clawmatcher/.env
#    UI .env needs MONGODB_URI, GEMINI_* and AGENT_API_URL=http://127.0.0.1:8100

# 4. launch both (wrapper scripts in the repo)
pm2 start agent/start-agent.sh --name matcher-agent --interpreter bash   # adk api_server :8100
pm2 start start-ui.sh          --name matcher-ui    --interpreter bash   # next start :3100
pm2 save
```

Put nginx in front of `:3100` for the public hostname + TLS (Let's Encrypt). With no registered
domain, a free wildcard host like `*.<ip>.sslip.io` works and gets a real cert.

Set environment variables on the server in the `.env` files (gitignored) — never in a committed file.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run seed` | Load the live catalog into MongoDB |
