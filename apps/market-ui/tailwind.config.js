/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic tokens resolve from CSS vars (oklch under the hood)
        background:   "var(--bg)",
        foreground:   "var(--text)",
        surface:      "var(--surface)",
        "surface-2":  "var(--surface-2)",
        line:         "var(--line)",
        "line-strong":"var(--line-strong)",
        "text-2":     "var(--text-2)",
        "text-3":     "var(--text-3)",
        "text-4":     "var(--text-4)",
        accent:       { DEFAULT: "var(--accent)", foreground: "var(--accent-ink)" },
        up:           "var(--up)",
        down:         "var(--down)",
        flat:         "var(--flat)",

        // Legacy shadcn aliases preserved so existing components keep rendering
        border:       "var(--line)",
        input:        "var(--line)",
        ring:         "var(--accent)",
        primary:      { DEFAULT: "var(--accent)",     foreground: "var(--accent-ink)" },
        secondary:    { DEFAULT: "var(--surface-2)",  foreground: "var(--text)" },
        destructive:  { DEFAULT: "var(--down)",       foreground: "var(--text)" },
        muted:        { DEFAULT: "var(--surface-2)",  foreground: "var(--text-2)" },
        popover:      { DEFAULT: "var(--surface-2)",  foreground: "var(--text)" },
        card:         { DEFAULT: "var(--surface)",    foreground: "var(--text)" },
      },
      fontFamily: {
        sans:    ["Archivo", "system-ui", "sans-serif"],
        display: ['"Archivo Narrow"', "Archivo", "sans-serif"],
        mono:    ['"Martian Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        label: ["11px", { lineHeight: "1.3", letterSpacing: "0.08em" }],
        data:  ["12px", { lineHeight: "1.35" }],
        body:  ["13px", { lineHeight: "1.5" }],
      },
      spacing: {
        "3xs": "2px",
        "2xs": "4px",
        xs:    "6px",
        sm:    "8px",
        md:    "12px",
        lg:    "16px",
        xl:    "24px",
        "2xl": "32px",
        "3xl": "48px",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "6px",
        xl: "8px",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up":   { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "accordion-up":   "accordion-up 160ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
