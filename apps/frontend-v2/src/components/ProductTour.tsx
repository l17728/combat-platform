import { useState } from "react";
import { Tour } from "antd";
import type { TourProps } from "antd";

const TOUR_KEY = "combat-tour-completed";

export function getCompletedTours(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TOUR_KEY) || "[]");
  } catch {
    return [];
  }
}

export function markTourCompleted(id: string) {
  const done = getCompletedTours();
  if (!done.includes(id)) {
    done.push(id);
    localStorage.setItem(TOUR_KEY, JSON.stringify(done));
  }
}

export function isTourCompleted(id: string): boolean {
  return getCompletedTours().includes(id);
}

export function resetAllTours() {
  localStorage.removeItem(TOUR_KEY);
}

interface ProductTourProps {
  tourId: string;
  steps: TourProps["steps"];
}

export default function ProductTour({ tourId, steps }: ProductTourProps) {
  const completed = isTourCompleted(tourId);
  const [open, setOpen] = useState(!completed);

  if (!open) return null;

  return (
    <Tour
      open={open}
      onClose={() => {
        markTourCompleted(tourId);
        setOpen(false);
      }}
      onFinish={() => {
        markTourCompleted(tourId);
        setOpen(false);
      }}
      steps={steps}
    />
  );
}
