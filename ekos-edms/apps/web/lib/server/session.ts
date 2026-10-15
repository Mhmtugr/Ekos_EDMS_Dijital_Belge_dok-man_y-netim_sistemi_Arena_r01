// Oturum çözümleme. AUTH_MODE=local veya oidc iken çalışır (oturum belirteci aynıdır); unset → null (sessiz düşüş yok).
import type { ActorContext } from "@ekos/core";
import { resolveSession } from "@ekos/db";
import { authMode, db } from "./runtime";
import { readCookie, SESSION_COOKIE } from "./http";

export async function actorFromRequest(req: Request): Promise<ActorContext | null> {
  const mode = authMode();
  if (mode !== "local" && mode !== "oidc") return null;
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return resolveSession(db(), token, new Date());
}
