"use client";

interface Props {
  message?: string;
}

export function StreamingIndicator({ message = "Searching…" }: Props) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-400">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gravity-500 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span>{message}</span>
    </div>
  );
}
