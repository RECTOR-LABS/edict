import { requireClientSession } from "@/lib/auth/middleware";
import { getClientBySlug } from "@/lib/db/queries/clients";
import { notFound } from "next/navigation";

export default async function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return requireClientSession(slug, async () => {
    const tenant = await getClientBySlug(slug);
    if (!tenant) notFound();
    const cssVar =
      tenant.brandColor != null
        ? ({ ["--tenant-color" as string]: tenant.brandColor } as React.CSSProperties)
        : undefined;
    return (
      <div style={cssVar} className="min-h-screen">
        <header className="border-b border-[rgba(255,255,255,0.08)] px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {tenant.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt="" className="h-8" />
            )}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[var(--tenant-color,#00e5ff)]">
                Edict
              </p>
              <p className="text-sm">{tenant.name}</p>
            </div>
          </div>
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="text-sm text-[#8a8a93] hover:text-[var(--tenant-color,#00e5ff)] transition-colors"
            >
              Log out
            </button>
          </form>
        </header>
        {children}
      </div>
    );
  });
}
