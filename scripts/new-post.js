import fs from 'fs';
import path from 'path';
import { title } from 'process';


function getDate() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}


const postTitle = process.argv[2];
if (!postTitle) {
  console.error('Please provide a post title.');
  process.exit(1);
}

// Basic slugification
const slug = postTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
const filename = `${slug}.mdx`; // Or .md
const contentDir = 'src/content/obras';
const assetsDir = 'src/assets'

// Ensure the content directory exists
if (!fs.existsSync(contentDir)) {
  fs.mkdirSync(contentDir, { recursive: true });
}

fs.mkdirSync(assetsDir + '/' + slug, { recursive: true });

const filePath = path.join(contentDir, filename);

const fileContent = `---
title: ${postTitle}
published: ${getDate()}
image: '../../assets/${slug}/imagen.png'
tags: []
company: ''
---
import Spoiler from '../../components/Spoiler.astro';
import beforeImage from '../../assets/${slug}/inicio.png'
import afterImage from '../../assets/${slug}/fin.png'

# Recomendado a...

# Sinopsis

### FICHA ARTÍSTICA:

<Spoiler
    imageBefore={beforeImage}
    imageAfter={afterImage}
>
¡Review pendiente!

¡Review pendiente!

¡Review pendiente!
</Spoiler>
`;

fs.writeFileSync(filePath, fileContent);
console.log(`Created new post: ${filePath}`);