import { PdfViewerPageWrapper } from '@/src/features/pdf/PdfViewerPageWrapper';

interface PdfPageProps {
  params: Promise<{
    attachmentId: string;
  }>;
}

export const metadata = {
  title: 'Visualizador e Editor de PDF — anotado!',
  description: 'Visualizador e editor de PDF integrado ao aplicativo anotado!',
};

export default async function PdfPage({ params }: PdfPageProps) {
  const { attachmentId } = await params;
  return <PdfViewerPageWrapper attachmentId={attachmentId} />;
}
