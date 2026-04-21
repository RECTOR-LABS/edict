import { AsyncLocalStorage } from "node:async_hooks";

export type AdminContext = {
  kind: "admin";
  sessionId: string;
  adminId: string;
};

export type ClientContext = {
  kind: "client";
  sessionId: string;
  memberId: string;
  clientId: string;
  clientSlug: string;
};

export type EdictContext = AdminContext | ClientContext;

const als = new AsyncLocalStorage<EdictContext>();

export function runWithContext<T>(ctx: EdictContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function getContext(): EdictContext {
  const c = als.getStore();
  if (!c) throw new Error("no edict context — use requireXSession() in a layout first");
  return c;
}

export function tryGetContext(): EdictContext | null {
  return als.getStore() ?? null;
}
