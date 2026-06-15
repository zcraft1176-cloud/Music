/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/js/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        primary: '#8b5cf6',
        secondary: '#06b6d4',
        dark: {
          100: '#1e1e2e',
          200: '#181825',
          300: '#11111b',
          400: '#0a0a0f'
        }
      }
    }
  },
  plugins: []
}
