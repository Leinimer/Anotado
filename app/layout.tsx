import type { Metadata, Viewport } from 'next';
import './globals.css';
import './editor-fixes.css';
import { PwaProvider } from '@/src/features/pwa/PwaProvider';
import { ThemeProvider } from '@/src/features/theme/theme-context';

export const metadata: Metadata = {
  title: 'Anotado',
  description: 'Um espaço para escrever.',
  applicationName: 'Anotado',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Anotado',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    shortcut: '/favicon.svg',
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/icons/brand-icon?size=180&maskable=true', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#fbf9f4',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('anotado_theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}else{document.documentElement.classList.remove('dark');document.documentElement.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-[#fbf9f4] dark:bg-[#000000] text-[#1b1c19] dark:text-[#ffffff] caret-[#1b1c19] dark:caret-[#ffffff] min-h-screen antialiased selection:bg-[#f4dfcb] selection:text-[#1b1c19] dark:selection:bg-[#333333] dark:selection:text-[#ffffff]">
        <ThemeProvider>
          <PwaProvider>{children}</PwaProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
