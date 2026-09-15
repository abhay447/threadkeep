/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        wa: {
          green: "#00a884",
          "green-dark": "#008069",
          accent: "#25d366",
          out: "#d9fdd3",
          "out-dark": "#005c4b",
          in: "#ffffff",
          "in-dark": "#202c33",
          bg: "#efeae2",
          "bg-dark": "#0b141a",
          panel: "#ffffff",
          "panel-dark": "#111b21",
          header: "#f0f2f5",
          "header-dark": "#202c33",
          muted: "#667781",
          "muted-dark": "#8696a0",
          line: "#e9edef",
          "line-dark": "#222e35",
          search: "#f0f2f5",
          "search-dark": "#202c33",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        bubble: "0 1px 0.5px rgba(11, 20, 26, 0.13)",
      },
    },
  },
  plugins: [],
};
