'use client';

import { useState } from 'react';
import SelectorCard from '@/components/SelectorCard';

export default function ProductsClient({ products }: any) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-8">Termékek</h1>

      <div className="border border-gray-400/70 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-6">
          Válasszon terméket!
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {products.map((p: any) => (
            <SelectorCard
              key={p.id}
              name={p.name}
              description={p.description}
              selected={selectedId === p.id}
              onClick={() => setSelectedId(p.id)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}