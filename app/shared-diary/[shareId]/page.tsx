import { SharedDiaryLayout } from '@/src/features/diary/ui/SharedDiaryLayout';

interface SharedDiaryPageProps {
  params: Promise<{
    shareId: string;
  }>;
}

export const metadata = {
  title: 'Diário Compartilhado — anotado!',
  description: 'Visualização de Diário compartilhado em modo somente leitura.',
};

export default async function SharedDiaryPage({ params }: SharedDiaryPageProps) {
  const { shareId } = await params;
  return <SharedDiaryLayout shareId={shareId} />;
}
