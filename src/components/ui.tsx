"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, SVGProps } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------- icons (decorative; always paired with text or aria-label) ----------

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
function base({ size = 22, ...p }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...p,
  };
}
export const Icon = {
  Mic: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  ),
  Stop: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  ),
  Clock: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  Check: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  ),
  Calendar: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  ),
  List: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  Sun: (p: IconProps) => (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </svg>
  ),
  Settings: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  ),
  Alert: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 3.5 2.8 19.5h18.4L12 3.5Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  ),
  Undo: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M15 8H8.5a4.5 4.5 0 0 0 0 9H12" />
      <path d="m12 4.5 3.5 3.5-3.5 3.5" />
    </svg>
  ),
  Plus: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  X: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  ChevronLeft: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="m14.5 6-6 6 6 6" />
    </svg>
  ),
  ChevronRight: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  ),
  Pin: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  ),
  Bell: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  ),
  Repeat: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M17 3.5 20 6.5l-3 3M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5l-3-3 3-3M20 12.5v1a4 4 0 0 1-4 4H4" />
    </svg>
  ),
  /** Planning: a list with a check — not a spinner look-alike. */
  Plan: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="m8 9 1.5 1.5L12 8M8 15.5h8M14 9.5h2" />
    </svg>
  ),
  Replan: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />
    </svg>
  ),
  Keyboard: (p: IconProps) => (
    <svg {...base(p)}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  ),
  History: (p: IconProps) => (
    <svg {...base(p)}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 4v4.5H8M12 8v4l3 2" />
    </svg>
  ),
};

// ---------- primitives ----------

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "min-h-10 px-4 text-[0.95rem]",
        size === "md" && "min-h-12 px-5",
        size === "lg" && "min-h-14 px-7 text-lg",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-strong",
        variant === "secondary" && "border border-line bg-surface text-ink hover:bg-sunken",
        variant === "ghost" && "text-accent-strong hover:bg-accent-soft",
        variant === "danger" && "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
        className,
      )}
    />
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 font-medium transition-colors",
        variant === "primary" && "bg-accent text-on-accent hover:bg-accent-strong",
        variant === "secondary" && "border border-line bg-surface hover:bg-sunken",
        variant === "ghost" && "text-accent-strong hover:bg-accent-soft",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("rounded-[var(--radius-card)] border border-line bg-surface p-4", className)}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3 pt-2">
      <div>
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex items-baseline justify-between">
      <h2 className="text-lg font-bold">{children}</h2>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-muted">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-faint">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "min-h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-ink placeholder:text-faint focus:border-accent focus:outline-none";

export function Chip({
  active,
  children,
  onClick,
  ...rest
}: { active?: boolean; children: ReactNode; onClick?: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      {...rest}
      className={cx(
        "min-h-10 rounded-full border px-4 text-[0.95rem] transition-colors",
        active ? "border-accent bg-accent text-on-accent" : "border-line bg-surface hover:bg-sunken",
        rest.className,
      )}
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "danger"; children: ReactNode; title?: string }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx(
        "rounded-2xl border px-4 py-3",
        tone === "info" && "border-accent/20 bg-accent-soft text-accent-strong",
        tone === "warn" && "border-warn-line bg-warn-soft text-warn",
        tone === "danger" && "border-danger/25 bg-danger-soft text-danger",
      )}
    >
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? "mt-0.5" : ""}>{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-muted">{children}</p>;
}

/** Visual + textual marker of an item's type (never color alone). */
export function KindBadge({ kind }: { kind: "event" | "task" | "unresolved" }) {
  const map = {
    event: { text: "אירוע", icon: <Icon.Clock size={15} />, cls: "bg-accent-soft text-accent-strong" },
    task: { text: "משימה", icon: <Icon.Check size={15} />, cls: "bg-sunken text-ink" },
    unresolved: { text: "לבירור", icon: <Icon.Alert size={15} />, cls: "bg-warn-soft text-warn" },
  }[kind];
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium", map.cls)}>
      {map.icon}
      {map.text}
    </span>
  );
}
