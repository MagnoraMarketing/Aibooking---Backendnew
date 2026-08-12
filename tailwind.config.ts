import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#dce8ff",
          200: "#b9d0ff",
          300: "#8caeff",
          400: "#5f8bff",
          500: "#3866f5",
          600: "#264ed1",
          700: "#1f3ea8",
          800: "#1c3585",
          900: "#1a2f6c",
        },
      },
    },
  },
  plugins: [],
};

export default config;
