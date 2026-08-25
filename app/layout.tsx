import type { Metadata, Viewport } from 'next';
import { Manrope, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { PwaProvider } from '@/src/features/pwa/PwaProvider';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  display: 'swap',
  weight: ['400', '600', '700'],
});

export const metadata: Metadata = {
  title: 'ANOTADO!',
  description: 'Um espaço para escrever.',
  applicationName: 'ANOTADO!',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ANOTADO!',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
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
    <html lang="pt-BR" className={`${manrope.variable} ${sourceSerif.variable}`}>
      <body className="bg-[#fbf9f4] text-[#1b1c19] min-h-screen antialiased selection:bg-[#f4dfcb] selection:text-[#1b1c19]">
        <PwaProvider>{children}</PwaProvider>
      </body>
    </html>
  );
}


