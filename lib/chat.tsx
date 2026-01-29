import React, { createContext, useContext, useMemo, useState } from "react";
import type { Message } from "./types";

type ChatContextValue = {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  append: (m: Message) => void;
  replaceById: (id: string, next: Message) => void;
  removeById: (id: string) => void;
  updateById: (id: string, updater: (m: Message) => Message) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: makeId(),
      role: "bot",
      kind: "status",
      text: "Search Khidmaty by typing below.",
      createdAt: Date.now(),
    },
  ]);

  const value = useMemo<ChatContextValue>(() => {
    return {
      messages,
      setMessages,
      append: (m) => setMessages((prev) => [...prev, m]),
      replaceById: (id, next) =>
        setMessages((prev) => prev.map((m) => (m.id === id ? next : m))),
      removeById: (id) => setMessages((prev) => prev.filter((m) => m.id !== id)),
      updateById: (id, updater) =>
        setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m))),
    };
  }, [messages]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within <ChatProvider>");
  return ctx;
}

export function createMessageId() {
  return makeId();
}

