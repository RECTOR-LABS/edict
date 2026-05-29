import { NextResponse, type NextRequest } from "next/server";
import { requestMagicLinkAction } from "@/actions/sessions";

// Route Handler wrapper around `requestMagicLinkAction`. Used because Next.js 16
// Server Actions throw "Connection closed." in the RSC streaming layer when
// running on Vercel Functions (see Next.js issue thread). Route Handlers don't
// go through that streaming path, so the same action body runs cleanly.
//
// The action itself is enumeration-defended (silent success on missing email
// or rate-limit), so this handler always 303-redirects to the landing page
// regardless of outcome.
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  await requestMagicLinkAction(formData);
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
