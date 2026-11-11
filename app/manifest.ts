import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Anotado',
    short_name: 'Anotado',
    description: 'Um espaço para escrever.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#fbf9f4',
    theme_color: '#fbf9f4',
    lang: 'pt-BR',
    dir: 'ltr',
    categories: ['productivity', 'utilities'],
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  };
}
