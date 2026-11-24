/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: '#121215',
        toolbar: '#1b1b20',
        panel: '#18181c',
        card: '#202026',
        borderSubtle: '#2b2b34',
        borderStrong: '#3e3e4b',
      },
    },
  },
  plugins: [],
};
