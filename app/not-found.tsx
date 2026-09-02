import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fbf9f4] text-[#1b1c19] p-4 font-sans-ui">
      <h2 className="text-2xl font-bold text-[#3b332d] mb-2">Página não encontrada</h2>
      <p className="text-sm text-[#7f756e] mb-6">A página que você está procurando não existe ou foi movida.</p>
      <Link
        href="/"
        className="px-4 py-2 bg-[#68594d] text-white rounded-lg text-sm font-medium hover:bg-[#56493f] transition-colors"
      >
        Voltar para o início
      </Link>
    </div>
  );
}
