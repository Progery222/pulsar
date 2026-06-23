/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Палитра §4 ТЗ (точные HEX).
        'bg-primary': '#0D0D0D',
        'bg-secondary': '#1A1A1A',
        'bg-tertiary': '#252525',
        'accent-green': '#CCFF00',
        'accent-orange': '#FF6B35',
        'text-primary': '#FFFFFF',
        'text-secondary': '#888888',
        border: '#2E2E2E',
        danger: '#FF4444',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        // Скругления §4 ТЗ: 8px карточки/кнопки, 4px мелкие элементы.
        card: '8px',
        el: '4px',
      },
    },
  },
  plugins: [],
};
