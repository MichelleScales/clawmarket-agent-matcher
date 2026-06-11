import { NextResponse } from "next/server";
import { matchWithAgent } from "@/lib/agent";
import { match } from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// On hosts that can't run the Python ADK agent + MongoDB MCP server (e.g. Vercel,
// serverless), set PROXY_TARGET to a deployment that can (the VPS). Requests are
// forwarded there so the response is still the real agent path.
const PROXY_TARGET = process.env.PROXY_TARGET;

export async function POST(req: Request) {
  let query = "";
  try {
    const body = await req.json();
    query = typeof body?.query === "string" ? body.query : "";
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!query.trim()) {
    return NextResponse.json({ error: "Please describe what you need." }, { status: 400 });
  }

  if (PROXY_TARGET) {
    try {
      const upstream = await fetch(`${PROXY_TARGET}/api/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    } catch (err) {
      console.error("Proxy to PROXY_TARGET failed:", err);
      return NextResponse.json(
        { error: "Could not reach the agent. Please try again." },
        { status: 502 },
      );
    }
  }

  // Primary: the ADK + MongoDB MCP agent. If the agent server is unreachable,
  // degrade to the in-process vector/keyword matcher so the UI still answers.
  try {
    const result = await matchWithAgent(query);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Agent path failed, falling back to direct match:", err);
    try {
      const result = await match(query);
      return NextResponse.json(result);
    } catch (err2) {
      console.error("Fallback match failed:", err2);
      return NextResponse.json(
        { error: "Could not reach the catalog. Please try again." },
        { status: 502 },
      );
    }
  }
}
