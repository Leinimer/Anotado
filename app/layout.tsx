import type { Metadata, Viewport } from 'next';
import { Manrope, Source_Serif_4 } from 'next/font/google';
import './globals.css';

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
  title: 'Anotado! — Digital Tactility',
  description: 'A quiet space for writing. Minimalist and high-performance tactile notes.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${sourceSerif.variable}`}>
      <body className="bg-[#fbf9f4] text-[#1b1c19] min-h-screen antialiased selection:bg-[#f4dfcb] selection:text-[#1b1c19]">
        {children}
      </body>
    </html>
  );
}

