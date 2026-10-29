import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { IconClock, IconRefresh } from "./Icons";

export function TimeMachineWidget() {
  const { simulatedClock, advanceTime, resetTime } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const formattedDate = new Date(simulatedClock).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="time-machine-container">
      <button
        type="button"
        className="time-machine-pill"
        onClick={() => setIsOpen(!isOpen)}
        title="Simulated Clock & Scenario Controller"
      >
        <IconClock className="w-4 h-4 text-accent" />
        <span className="time-machine-date">{formattedDate}</span>
      </button>

      {isOpen && (
        <div className="time-machine-popup">
          <div className="time-machine-header">
            <strong>Simulated Clock (Time Travel)</strong>
            <p className="small muted">
              Fast-forward simulated time to demonstrate deadline countdowns, SLA warnings, and automatic escalations during screen recordings.
            </p>
          </div>

          <div className="time-machine-actions">
            <button
              type="button"
              className="btn-scenario"
              onClick={() => {
                advanceTime(1);
                setIsOpen(false);
              }}
            >
              +1 Day
            </button>
            <button
              type="button"
              className="btn-scenario warning"
              onClick={() => {
                advanceTime(7);
                setIsOpen(false);
              }}
            >
              +7 Days (SLA Warning)
            </button>
            <button
              type="button"
              className="btn-scenario danger"
              onClick={() => {
                advanceTime(15);
                setIsOpen(false);
              }}
            >
              +15 Days (Trigger Breach &amp; Escalation)
            </button>
            <button
              type="button"
              className="btn-scenario reset"
              onClick={() => {
                resetTime();
                setIsOpen(false);
              }}
            >
              <IconRefresh className="w-3.5 h-3.5" /> Reset to Baseline
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
