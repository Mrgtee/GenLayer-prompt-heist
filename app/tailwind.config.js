/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        noir: "0 25px 80px rgba(0,0,0,0.55)",
      },
    },
  },
  plugins: [],
};

