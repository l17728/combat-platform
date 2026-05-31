import { useState, useCallback } from "react";

export interface DashboardCard {
  id: string;
  label: string;
  visible: boolean;
}

const STORAGE_KEY = "combat-dashboard-cards";

export const DEFAULT_CARDS: DashboardCard[] = [
  { id: "stats", label: "统计概览", visible: true },
  { id: "myTasks", label: "分配给我", visible: true },
  { id: "favorites", label: "我的关注", visible: true },
  { id: "slaRisk", label: "SLA 风险", visible: true },
  { id: "recent", label: "最近活跃", visible: true },
  { id: "statusBar", label: "状态分布", visible: true },
];

function load(): DashboardCard[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_CARDS.map((c) => ({ ...c }));
}

function save(cards: DashboardCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

export function useDashboardConfig() {
  const [cards, setCards] = useState<DashboardCard[]>(load);

  const update = useCallback((next: DashboardCard[]) => {
    setCards(next);
    save(next);
  }, []);

  const toggleVisible = useCallback(
    (id: string) => {
      update(cards.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)));
    },
    [cards, update]
  );

  const moveUp = useCallback(
    (id: string) => {
      const idx = cards.findIndex((c) => c.id === id);
      if (idx <= 0) return;
      const next = [...cards];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      update(next);
    },
    [cards, update]
  );

  const moveDown = useCallback(
    (id: string) => {
      const idx = cards.findIndex((c) => c.id === id);
      if (idx < 0 || idx >= cards.length - 1) return;
      const next = [...cards];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      update(next);
    },
    [cards, update]
  );

  const resetToDefault = useCallback(() => {
    update(DEFAULT_CARDS.map((c) => ({ ...c })));
  }, [update]);

  const isVisible = useCallback((id: string) => cards.find((c) => c.id === id)?.visible ?? true, [cards]);

  const visibleOrder = cards.filter((c) => c.visible).map((c) => c.id);

  return { cards, toggleVisible, moveUp, moveDown, resetToDefault, isVisible, visibleOrder };
}
