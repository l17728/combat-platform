import { useCallback } from "react";
import { message } from "antd";
import { useAuth } from "./useAuth.js";

const GUEST_BLOCKED_MSG = "游客仅可参观系统管理功能，无法执行操作";

const SYSTEM_PATHS = [
  "/import",
  "/schema",
  "/config",
  "/email",
  "/digest",
  "/llm-settings",
  "/audit",
  "/backup",
  "/merge",
  "/system-upgrade",
  "/db-migration",
  "/op-log",
  "/webhooks",
  "/invitations",
  "/users",
  "/platform",
  "/notifications",
];

function isSystemPage(): boolean {
  const path = window.location.pathname;
  return SYSTEM_PATHS.some((prefix) => path.startsWith(prefix));
}

/**
 * Returns a guard function that blocks write actions for guest users
 * **only on system management pages**. On business pages (attack, contributions,
 * wiki, etc.), guests can perform normal CRUD operations.
 */
export function useGuestGuard() {
  const { isGuest } = useAuth();

  const guard = useCallback((): boolean => {
    if (isGuest && isSystemPage()) {
      message.warning(GUEST_BLOCKED_MSG);
      return false;
    }
    return true;
  }, [isGuest]);

  return { guard, isGuest };
}
