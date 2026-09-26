// app/page.tsx
// Trang upload chính

import UploadForm from '@/components/UploadForm';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

export default async function Home() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect('/setup');
  }

  return (
    <main className="py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold font-heading text-[#1A428A]">
          Convert to Markdown
        </h1>
        <p className="text-gray-500 mt-2 text-base">
          Upload file Word, PDF hoặc TXT, nhận markdown tối ưu cho AI
        </p>
      </div>
      <UploadForm />
    </main>
  );
}
