import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const config = {
  devIndicators: false,
  env: { NEXT_PUBLIC_APP_ROLE: "staff", NEXT_PUBLIC_APP_MODE: "legacy" },
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  async redirects() {
    return [{ source: "/lich", destination: "/lich-lam-viec", permanent: false }]
  },
}

if (process.env.NODE_ENV === "development") {
  // A local worktree may reuse dependencies through a junction into a sibling
  // checkout. Both tracing and Turbopack must include that resolved dependency.
  const require = createRequire(import.meta.url)
  const dependency = realpathSync(require.resolve("next/package.json"))
  let root = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const location = relative(root, dependency)
    if (location !== ".." && !location.startsWith(".." + sep) && !isAbsolute(location)) break
    const parent = dirname(root)
    if (parent === root) throw new Error("Staff dependencies must share a filesystem volume with the application")
    root = parent
  }
  Object.assign(config, { outputFileTracingRoot: root, turbopack: { root } })
}

export default config
