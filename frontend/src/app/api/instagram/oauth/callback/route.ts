import { NextRequest, NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/server/auth-handlers";

export async function GET(request: NextRequest) {
  const backendResponse = await proxyBackendRequest(request, [
    "instagram",
    "oauth",
    "callback",
  ]);
  const destination = new URL("/instagram/accounts", request.url);
  destination.searchParams.set(
    "connection",
    backendResponse.ok ? "success" : "error",
  );
  const response = NextResponse.redirect(destination, { status: 303 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
