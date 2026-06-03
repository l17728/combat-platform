import { useCallback } from "react";
import { message } from "antd";
import { useAuth } from "./useAuth.js";

const GUEST_BLOCKED_MSG = "游客参观期间，请勿触动控制面板，谢谢！";

/**
 * Returns a guard function that blocks write actions for guest users.
 * Call `guard()` before any state-mutating action (opening a drawer/modal,
 * clicking save/delete, toggling switches, etc).
 *
 * Returns true if the action should proceed (non-guest),
 * false if it was blocked (guest).
 */
export function useGuestGuard() {
  const { isGuest } = useAuth();

  const guard = useCallback((): boolean => {
    if (isGuest) {
      message.warning(GUEST_BLOCKED_MSG);
      return false;
    }
    return true;
  }, [isGuest]);

  return { guard, isGuest };
}
