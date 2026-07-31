/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--app-bg-base)',
        surface: 'var(--app-surface)',
        foreground: 'var(--app-text)',
        muted: 'var(--app-text-muted)',
        accent: 'var(--app-accent)',
      },
      fontFamily: {
        sans: ['Inter', 'Geist Sans', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--app-radius-md)',
        xl: 'var(--app-radius-lg)',
      },
      boxShadow: {
        soft: 'var(--app-shadow-sm)',
        ambient: 'var(--app-shadow-md)',
        glow: 'var(--app-shadow-lg)',
      },
      transitionTimingFunction: {
        expo: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}