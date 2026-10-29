import { useEffect } from "react";
export function DialogAccessibility() {
  useEffect(() => {
    let previous: HTMLElement | null = null;
    let active: HTMLElement | null = null;
    const focusables = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length);
    const sync = () => {
      const dialog =
        Array.from(
          document.querySelectorAll<HTMLElement>(".modal-dialog,.drawer-panel"),
        ).at(-1) || null;
      if (dialog === active) return;
      if (!dialog) {
        previous?.focus();
        active = null;
        return;
      }
      previous =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      active = dialog;
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const heading = dialog.querySelector("h2,h3");
      if (heading) {
        heading.id ||= "onedesk-dialog-title";
        dialog.setAttribute("aria-labelledby", heading.id);
      }
      dialog
        .querySelectorAll<HTMLButtonElement>(".btn-icon-close")
        .forEach((button) => {
          if (!button.getAttribute("aria-label"))
            button.setAttribute("aria-label", "Close dialog");
        });
      dialog.tabIndex = -1;
      (focusables(dialog)[0] || dialog).focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      if (e.key === "Escape") {
        const close =
          active.querySelector<HTMLButtonElement>(
            '.btn-icon-close,[aria-label^="Close"]',
          ) ||
          Array.from(active.querySelectorAll<HTMLButtonElement>("button")).find(
            (b) => b.textContent?.trim() === "Cancel",
          );
        if (close) {
          e.preventDefault();
          close.click();
        }
      }
      if (e.key === "Tab") {
        const items = focusables(active);
        const first = items[0];
        const last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("keydown", onKey);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
