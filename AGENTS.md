<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Release checklist

- The public application URL is `https://hejja-okofarm.hu`; `*.workers.dev` is only a diagnostic URL.
- Before reporting a deploy as successful, verify the public URL with an HTTP request and confirm that it returns a successful status.
- Keep the public domain in `wrangler.jsonc` as a Cloudflare Worker Route (`custom_domain: false`), not a Custom Domain — the zone's DNS is externally managed, so a Custom Domain trigger will fail to attach. A successful Worker upload alone is not a successful release.
