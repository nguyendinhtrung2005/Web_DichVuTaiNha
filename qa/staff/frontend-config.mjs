/** Private QA snapshot only: avoid the filesystem cache implicated in QA V8 OOM. */
export const STAFF_QA_NODE_OPTIONS = '--max-old-space-size=2048'

export function staffQaNextConfig(source, tracingRoot) {
  const { turbopack, ...config } = source
  return {
    ...config,
    agentRules: false,
    outputFileTracingRoot: tracingRoot,
    experimental: { ...config.experimental, cpus: 2, webpackMemoryOptimizations: true },
    webpack(input, context) {
      const result = config.webpack ? config.webpack(input, context) : input
      if (context.dev) result.cache = false
      return result
    },
  }
}
