/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT: '#F5B301', soft: '#F5B30122', dark: '#B88600' },
        ink: { 950: '#09090B', 900: '#0F0F12', 850: '#141418', 800: '#1A1A1F', 700: '#25252C', 600: '#33333C', 400: '#8A8A96', 300: '#B4B4BE' },
      },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
