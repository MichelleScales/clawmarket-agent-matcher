#!/usr/bin/env bash
# Launch the ADK agent API server (used by pm2 as "matcher-agent").
# It serves the clawmatcher agent and is reached by the Next.js /api/agent route.
cd /root/agent-matcher/agent
exec ./.venv/bin/adk api_server --port 8100 --host 127.0.0.1 .
