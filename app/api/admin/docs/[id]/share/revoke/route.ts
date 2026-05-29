import { NextResponse, type NextRequest } from "next/server";
import { unshareAction } from "@/actions/share";

// POST /api/admin/docs/[id]/share/revoke — revoke a doc share for a client.
// See app/api/admin/clients/route.ts for why admin writes are Route Handlers.
// The action reads docId + clientId from the form body; [id] is used to
// redirect back to the doc's share page.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const formData = await req.formData();
  await unshareAction(formData);
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  return NextResponse.redirect(new URL(`/admin/docs/${id}/share`, base), 303);
}
