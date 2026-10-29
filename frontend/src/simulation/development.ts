import { simulationStore } from "./simulationStore";
declare global {
  interface Window {
    onedeskDevelopment?: {
      reset: () => void;
      advanceDays: (days: number) => void;
    };
  }
}
if (import.meta.env.DEV)
  window.onedeskDevelopment = {
    reset: () => simulationStore.resetPresentationData(),
    advanceDays: (days) => simulationStore.advanceSimulatedClock(days),
  };
