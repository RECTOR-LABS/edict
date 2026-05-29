import { NextResponse, type NextRequest } from "next/server";
import { createDocAction } from "@/actions/docs";

// POST /api/admin/docs — create a doc.
// See app/api/admin/clients/route.ts for why admin writes are Route Handlers.
// The action returns the created row so we can redirect to its edit page.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const doc = await createDocAction(formData);
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  return NextResponse.redirect(new URL(`/admin/docs/${doc.id}`, base), 303);
}
