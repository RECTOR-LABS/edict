import { NextResponse, type NextRequest } from "next/server";
import { createClientAction } from "@/actions/clients";

// POST /api/admin/clients — create a client (tenant).
//
// Admin write actions run as Route Handlers rather than <form action={fn}>:
// Next.js 16 Server Actions throw "Connection closed." in the react-server-dom
// streaming layer on Vercel Functions (see app/api/auth/request-link/route.ts).
// The action does the admin-gated mutation and returns the created row; this
// handler owns the redirect with an explicit 303 (redirect() defaults to 307,
// which would make the browser re-POST the target page).
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const client = await createClientAction(formData);
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  // Redirect by slug — the /admin/clients/[slug] route resolves by slug, not id.
  return NextResponse.redirect(new URL(`/admin/clients/${client.slug}`, base), 303);
}
