import type { Reminder, ChannelAdapter } from "@combat/shared";

export class StubChannelAdapter implements ChannelAdapter {
  send(_r: Reminder, _actor: string) {
    return { sentAt: new Date().toISOString() };
  }
}
