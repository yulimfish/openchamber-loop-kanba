export interface LeaseChannel {
  postMessage(data: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type ChannelFactory = (name: string) => LeaseChannel;

export interface WriterLeaseOptions {
  channelFactory?: ChannelFactory;
  id?: string;
}

const channelName = "openchamber-loop-kanba/board-writer";

export const createWriterLease = ({
  channelFactory = (name) => new BroadcastChannel(name),
  id = crypto.randomUUID(),
}: WriterLeaseOptions = {}) => {
  const channel = channelFactory(channelName);
  const candidates = new Set([id]);
  const changeListeners = new Set<() => void>();
  const isWriter = () => [...candidates].sort()[0] === id;
  let lastWriter = isWriter();
  const notify = () => {
    const next = isWriter();
    if (next === lastWriter) return;
    lastWriter = next;
    changeListeners.forEach((listener) => listener());
  };
  const announce = () => channel.postMessage({ type: "announce", id });
  const onMessage = (event: MessageEvent) => {
    const message = event.data;
    if (!message || typeof message !== "object" || message.type !== "announce" || typeof message.id !== "string") return;
    if (candidates.has(message.id)) return;
    candidates.add(message.id);
    if (message.id !== id) announce();
    notify();
  };
  channel.addEventListener("message", onMessage);
  announce();

  return {
    ready: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    isWriter,
    onChange: (listener: () => void): (() => void) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    dispose: () => {
      channel.removeEventListener("message", onMessage);
      changeListeners.clear();
      channel.close();
    },
  };
};
