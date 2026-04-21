import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tenant: "var(--tenant-color, #00e5ff)",
      },
    },
  },
  plugins: [],
};

export default config;
