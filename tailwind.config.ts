import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Ubuntu", "Noto Sans", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "SFMono-Regular", "Menlo", "Ubuntu Mono", "monospace"],
      },
      colors: {
        // Near-black neutrals with a hint of green (Volt liquid glass)
        ink: {
          950: "#050807",
          900: "#0a0f0c",
          850: "#101612",
          800: "#151d18",
          700: "#212b25",
          600: "#33403a",
          500: "#56635c",
        },
        // Volt accent: electric lime
        syntaz: {
          300: "#e2fb9a",
          400: "#d4f76a",
          500: "#c8f550",
          600: "#b4ec36",
          700: "#8fc51c",
          900: "#2f4a05",
        },
      },
      keyframes: {
        blink: { "0%, 80%, 100%": { opacity: "0.25" }, "40%": { opacity: "1" } },
        "fade-in-up": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "dialog-in": { from: { opacity: "0", transform: "translateY(8px) scale(0.98)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        blink: "blink 1.4s infinite ease-in-out both",
        "fade-in-up": "fade-in-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "fade-in": "fade-in 180ms ease-out both",
        "dialog-in": "dialog-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [typography],
};

export default config;
