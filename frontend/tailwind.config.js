/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        'signal-red': '#ff3b30',
        'signal-green': '#34c759',
        'signal-blue': '#007aff',
        'dark-bg': '#121212',
        'darker-bg': '#0a0a0a',
      },
    },
  },
  plugins: [
    require('daisyui'),
  ],
  darkMode: 'class',
  daisyui: {
    themes: ["light", "dark"],
    darkTheme: "dark",
  },
} 