import { useState, useMemo } from "react";
import { Tour } from "antd";
import type { TourProps } from "antd";
import { useAuth } from "../hooks/useAuth.js";
import { api } from "../api.js";

const TOUR_KEY = "combat-tour-completed";

export function resetAllTours() {
  localStorage.removeItem(TOUR_KEY);
}

interface ProductTourProps {
  tourId: string;
  steps: TourProps["steps"];
}

export default function ProductTour({ tourId, steps }: ProductTourProps) {
  const { user } = useAuth();
  const completed = user?.tourCompleted?.includes(tourId) ?? false;
  const [open, setOpen] = useState(!completed);

  const validSteps = useMemo(() => {
    if (!steps) return [];
    return steps.filter((step) => {
      if (!step.target) return true;
      try {
        const target = step.target;
        const el = typeof target === "function" ? target() : target;
        return el != null;
      } catch {
        return false;
      }
    });
  }, [steps]);

  if (!open || validSteps.length === 0) {
    if (open && validSteps.length === 0 && !completed) {
      api.completeTour(tourId).catch(() => {});
    }
    return null;
  }

  return (
    <Tour
      open={open}
      onClose={() => {
        setOpen(false);
        api.completeTour(tourId).catch(() => {});
      }}
      onFinish={() => {
        setOpen(false);
        api.completeTour(tourId).catch(() => {});
      }}
      steps={validSteps}
    />
  );
}
