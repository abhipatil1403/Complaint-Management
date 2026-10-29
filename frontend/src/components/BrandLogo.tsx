import { useState } from "react";
import { IconShield } from "./Icons";

interface BrandLogoProps {
  size?: number;
  className?: string;
  fallbackIconClass?: string;
}

/**
 * AICTE OneDesk Brand Logo
 * Displays `/logo.png` placed in the `frontend/public/` directory.
 * Gracefully falls back to the canonical Shield icon if `logo.png` is missing or fails to load.
 */
export function BrandLogo({
  size = 36,
  className = "",
  fallbackIconClass = "w-5 h-5 text-white",
}: BrandLogoProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return <IconShield className={fallbackIconClass} />;
  }

  return (
    <img
      src="/logo.png"
      alt="AICTE OneDesk Logo"
      className={`brand-logo-img ${className}`.trim()}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: "contain",
        display: "block",
      }}
      onError={() => setHasError(true)}
    />
  );
}

