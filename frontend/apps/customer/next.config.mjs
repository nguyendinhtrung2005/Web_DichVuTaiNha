const browserTest = process.env.CLEANHOME_CUSTOMER_BROWSER_TEST === "1"

export default {
  devIndicators: false,
  distDir: browserTest ? ".next/customer-browser-test" : ".next",
  env: { NEXT_PUBLIC_APP_ROLE: "customer", NEXT_PUBLIC_APP_MODE: "legacy" },
  images: {
    unoptimized: false,
    localPatterns: [{ pathname: "/images/**", search: "" }],
    formats: ["image/webp"],
  },
  typescript: {
    ignoreBuildErrors: false,
    ...(browserTest ? { tsconfigPath: ".customer-browser-tsconfig.json" } : {}),
  },
}
