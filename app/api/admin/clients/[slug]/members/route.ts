import { NextResponse, type NextRequest } from "next/server";
import { addMemberAction } from "@/actions/members";

// POST /api/admin/clients/[slug]/members — add (upsert) a member to a client.
// See app/api/admin/clients/route.ts for why admin writes are Route Handlers.
// The action reads clientId from the form body; [slug] is used only to redirect
// back to the (slug-keyed) client detail page.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const formData = await req.formData();
  await addMemberAction(formData);
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  return NextResponse.redirect(new URL(`/admin/clients/${slug}`, base), 303);
}
