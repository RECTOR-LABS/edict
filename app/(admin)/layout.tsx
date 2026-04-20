import { requireAdminSession } from "@/lib/auth/middleware";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  return requireAdminSession(async () => <>{children}</>);
}
