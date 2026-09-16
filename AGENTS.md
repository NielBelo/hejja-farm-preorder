<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Release checklist

- The public application URL is `https://hejja-farm.hu`; `*.workers.dev` is only a diagnostic URL.
- Before reporting a deploy as successful, verify the public URL with an HTTP request and confirm that it returns a successful status.
- Keep the public domain in `wrangler.jsonc` as a Cloudflare custom domain route. A successful Worker upload alone is not a successful release.
