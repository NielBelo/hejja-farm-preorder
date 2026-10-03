// esbuild alias-cél a "server-only" csomaghoz (lásd wrangler.jsonc
// "alias"). Az npm "server-only" csomag NINCS telepítve a projektben -
// Next.js build közben saját belső bundler-alias segítségével oldja fel
// (lásd node_modules/next/types/global.d.ts ambient "server-only" modult),
// amit a worker/index.ts-t (és rajta keresztül a lib/email/*.ts fájlokban
// lévő "import \"server-only\";" sorokat) bundle-elő wrangler/esbuild nem
// ismer. Ez az üres stub ugyanazt a no-op viselkedést adja wrangler/esbuild
// alatt, mint amit Next.js már ma is biztosít.
export {};
