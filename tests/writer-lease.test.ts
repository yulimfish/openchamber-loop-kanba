import { expect, test } from "bun:test";

import { createWriterLease, type ChannelFactory } from "../src/writer-lease";

const createChannels = (): ChannelFactory => {
  const channels = new Map<string, Set<(event: MessageEvent) => void>>();
  return (name) => {
    const listeners = channels.get(name) ?? new Set<(event: MessageEvent) => void>();
    channels.set(name, listeners);
    return {
      postMessage: (data) => listeners.forEach((listener) => queueMicrotask(() => listener({ data } as MessageEvent))),
      addEventListener: (_type, listener) => listeners.add(listener as (event: MessageEvent) => void),
      removeEventListener: (_type, listener) => listeners.delete(listener as (event: MessageEvent) => void),
      close: () => undefined,
    };
  };
};

test("elects the lexicographically smallest page as the only writer", async () => {
  const channelFactory = createChannels();
  const first = createWriterLease({ channelFactory, id: "a" });
  const second = createWriterLease({ channelFactory, id: "b" });

  await Promise.all([first.ready(), second.ready()]);

  expect(first.isWriter()).toBe(true);
  expect(second.isWriter()).toBe(false);
  first.dispose();
  second.dispose();
});

test("notifies an existing writer when a smaller peer appears", async () => {
  const channelFactory = createChannels();
  const existing = createWriterLease({ channelFactory, id: "b" });
  await existing.ready();
  expect(existing.isWriter()).toBe(true);

  let changes = 0;
  existing.onChange(() => { changes += 1; });
  const smaller = createWriterLease({ channelFactory, id: "a" });
  await smaller.ready();
  await existing.ready();

  expect(existing.isWriter()).toBe(false);
  expect(changes).toBeGreaterThan(0);
  existing.dispose();
  smaller.dispose();
});
