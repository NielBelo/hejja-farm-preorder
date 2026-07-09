import { supabase } from '@/lib/supabase';
import ProductsClient from '@/components/ProductsClient';

export default async function ProductsPage() {
  const { data: products, error } = await supabase
    .from('products')
    .select('*');

  if (error) {
    return <div>Hiba: {error.message}</div>;
  }

  return <ProductsClient products={products ?? []} />;
}