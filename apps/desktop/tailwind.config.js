/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        shell: {
          bg: '#0f1720',
          panel: '#17212b',
          accent: '#e76f51',
          text: '#f4f1ea',
          muted: '#9eb0c2',
          border: '#253444',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        shell: '0 1.5rem 3rem rgba(0, 0, 0, 0.2)',
      },
      borderRadius: {
        shell: '1.75rem',
      },
    },
  },
  plugins: [],
};
