// @ts-check
import { defineConfig } from 'astro/config';
import mdx from "@astrojs/mdx";
import tailwind from '@astrojs/tailwind';
import pagefind from "astro-pagefind";

// https://astro.build/config
export default defineConfig({
  integrations: [mdx(), tailwind(), pagefind()]
});