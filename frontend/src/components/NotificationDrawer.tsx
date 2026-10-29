import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useSimulation, visibleNotifications } from "../simulation/selectors";
import { simulationStore } from "../simulation/simulationStore";
import type { SimNotification } from "../simulation/types";
import { IconCheck, IconClose } from "./Icons";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationDrawer({ isOpen, onClose }: Props) {
  const [filter, setFilter] = useState<"all" | "unread" | "sla" | "assignment">(
    "all",
  );
  const { activePersona } = useAuth();
  const state = useSimulation();
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [isOpen, onClose]);
  const notifications = visibleNotifications(state, activePersona);

  if (!isOpen) return null;

  const filtered = notifications.filter((n) => {
    if (filter === "unread") return !n.is_read;
    if (filter === "sla")
      return n.type === "sla_warning" || n.type === "escalation";
    if (filter === "assignment")
      return n.type === "assignment" || n.type === "access_request";
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleMarkAllRead = () => {
    notifications.forEach((n) => simulationStore.markNotificationRead(n.id));
  };

  const handleNotificationClick = (notif: SimNotification) => {
    simulationStore.markNotificationRead(notif.id);
    onClose();
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer-panel"
        onClick={(e) => e.stopPropagation()}
        aria-label="Notification Center"
      >
        <div className="drawer-header">
          <div className="drawer-title-row">
            <h2>Notifications</h2>
            {unreadCount > 0 && (
              <span className="drawer-badge">{unreadCount} new</span>
            )}
          </div>
          <div className="drawer-actions">
            {unreadCount > 0 && (
              <button
                type="button"
                className="btn-text-quiet"
                onClick={handleMarkAllRead}
              >
                <IconCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
            <button
              type="button"
              className="btn-icon-close"
              onClick={onClose}
              aria-label="Close notifications"
            >
              <IconClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter pills */}
        <div className="drawer-tabs">
          <button
            type="button"
            className={`drawer-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            className={`drawer-tab ${filter === "unread" ? "active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            Unread ({unreadCount})
          </button>
          <button
            type="button"
            className={`drawer-tab ${filter === "sla" ? "active" : ""}`}
            onClick={() => setFilter("sla")}
          >
            SLA &amp; Escalations
          </button>
          <button
            type="button"
            className={`drawer-tab ${filter === "assignment" ? "active" : ""}`}
            onClick={() => setFilter("assignment")}
          >
            Assignments
          </button>
        </div>

        {/* Notifications list */}
        <div className="drawer-body">
          {filtered.length === 0 ? (
            <div className="drawer-empty">
              <p>No notifications in this view.</p>
            </div>
          ) : (
            <ul className="notif-list">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className={`notif-item ${!n.is_read ? "notif-unread" : ""} notif-type-${n.type}`}
                >
                  <Link
                    to={n.link_to || "/"}
                    onClick={() => handleNotificationClick(n)}
                    className="notif-link"
                  >
                    <div className="notif-top">
                      <span className="notif-badge">
                        {n.type.replace(/_/g, " ")}
                      </span>
                      <time className="notif-time">
                        {new Date(n.created_at).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <strong className="notif-title">{n.title}</strong>
                    <p className="notif-message">{n.message}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
