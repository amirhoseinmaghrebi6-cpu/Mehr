"use client";

/**
 * A home's scenarios for the app shell. Refreshed after every change and every 30 seconds while
 * the page is visible, so a scheduled run (or a missed one) shows up without a reload.
 */
import { useCallback, useEffect, useState } from "react";
import type { Scenario } from "@m2smart/contracts";
import type { HomeGateway } from "@/services/home-gateway";

const REFRESH_MS = 30_000;

export function useScenarios(gateway: HomeGateway, propertyId: string | null) {
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      setScenarios(await gateway.listScenarios(propertyId));
    } catch {
      // Keep the last list; the next refresh tries again.
      setScenarios((current) => current ?? []);
    }
  }, [gateway, propertyId]);

  useEffect(() => {
    setScenarios(null);
    void refresh();
    if (!propertyId) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [propertyId, refresh]);

  /** Puts a saved scenario in the list (new or replacing the old one). */
  const upsert = useCallback((scenario: Scenario) => {
    setScenarios((current) => {
      const list = current ?? [];
      return list.some((item) => item.id === scenario.id) ? list.map((item) => (item.id === scenario.id ? scenario : item)) : [...list, scenario];
    });
  }, []);

  const remove = useCallback((scenarioId: string) => setScenarios((current) => (current ?? []).filter((item) => item.id !== scenarioId)), []);

  return { scenarios, refresh, upsert, remove };
}
