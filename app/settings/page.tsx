// app/settings/page.tsx
// Trang cài đặt AI provider

import SettingsForm from '@/components/SettingsForm';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

export default async function SettingsPage() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    redirect('/setup');
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A428A]">Cài đặt AI</h1>
        <p className="text-gray-500 text-sm mt-1">
          Cấu hình API key và model AI dùng để mô tả hình ảnh và convert PDF.
        </p>
      </div>
      <SettingsForm />
    </main>
  );
}
