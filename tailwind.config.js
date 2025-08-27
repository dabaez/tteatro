import { defineConfig } from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        'brand-red': '#e54b4b',
        'brand-peach': '#ffa987',
        'brand-bg': '#f7ebe8',
        'brand-text': '#444140',
        'brand-dark': '#1e1e24',
      },
      fontFamily:{
        display: ['Caprasimo', 'cursive'],
        sans: ['Lexend Deca', 'sans-serif'],
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}

