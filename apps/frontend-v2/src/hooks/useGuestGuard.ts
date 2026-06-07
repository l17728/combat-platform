import { useCallback } from "react";
import { message } from "antd";
import { useAuth } from "./useAuth.js";
import { isSystemPath } from "../system-paths.js";

const GUEST_BLOCKED_MSG = "游客仅可参观系统管理功能，无法执行操作";

export function useGuestGuard() {
  const { isGuest } = useAuth();

  const guard = useCallback((): boolean => {
    if (isGuest && isSystemPath(window.location.pathname)) {
      message.warning(GUEST_BLOCKED_MSG);
      return false;
    }
    return true;
  }, [isGuest]);

  return { guard, isGuest };
}
