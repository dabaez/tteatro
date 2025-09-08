import { defineCollection, z } from 'astro:content';

const obrasCollection = defineCollection({
  type: 'content',
  schema: ({ image }) => z.object({
    title: z.string(),
    published: z.date(),
    company: z.string(),
    tags: z.array(z.string()),
    image: image(),
    tickets: z.string().url().optional(),
  }),
});

export const collections = {
  'obras': obrasCollection,
};