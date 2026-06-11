#!/usr/bin/env bash
# Launch the Next.js production server (used by pm2 as "matcher-ui").
# Reads .env (MONGODB_URI, AGENT_API_URL, etc.). Port 3100 keeps it clear of
# anything already on :3000.
cd /root/agent-matcher
exec npm run start -- -p 3100
