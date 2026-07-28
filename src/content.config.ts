import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const obrasCollection = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/obras' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    published: z.date(),
    company: z.string(),
    tags: z.array(z.string()),
    image: image(),
  }),
});

export const collections = {
  'obras': obrasCollection,
};
