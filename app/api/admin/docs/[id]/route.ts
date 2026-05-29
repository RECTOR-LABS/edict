import { NextResponse, type NextRequest } from "next/server";
import { updateDocAction } from "@/actions/docs";

// POST /api/admin/docs/[id] — update a doc.
// See app/api/admin/clients/route.ts for why admin writes are Route Handlers.
// The action reads the doc id from the form body and validates existence;
// [id] is used to redirect back to the doc's edit page.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const formData = await req.formData();
  await updateDocAction(formData);
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  return NextResponse.redirect(new URL(`/admin/docs/${id}`, base), 303);
}
