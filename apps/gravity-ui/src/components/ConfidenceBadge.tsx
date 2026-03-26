import { cn } from "@/lib/utils";

interface Props {
  confidence: "HIGH" | "MEDIUM" | "LOW";
  className?: string;
}

const CONFIG = {
  HIGH: {
    label: "High Confidence",
    dot: "bg-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  MEDIUM: {
    label: "Medium Confidence",
    dot: "bg-amber-400",
    badge: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  LOW: {
    label: "Low Confidence",
    dot: "bg-red-400",
    badge: "bg-red-500/10 text-red-400 border-red-500/30",
  },
};

export function ConfidenceBadge({ confidence, className }: Props) {
  const c = CONFIG[confidence];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
        c.badge,
        className
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}
