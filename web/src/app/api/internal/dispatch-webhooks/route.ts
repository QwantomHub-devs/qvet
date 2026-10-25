import { NextResponse } from "next/server";
import { flushOutboundWebhooks } from "@/lib/qfellows/webhook-dispatcher";

export async function POST(request: Request) {
  // Verify internal invocation authorization header
  const authHeader = request.headers.get("authorization");
  const expectedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (expectedKey && authHeader !== `Bearer ${expectedKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await flushOutboundWebhooks(50);
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
