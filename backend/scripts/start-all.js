const { spawn } = require("node:child_process")
const path = require("node:path")

const root = path.resolve(__dirname, "..")
const services = [
  "auth-service/src/app.js",
  "order-service/src/app.js",
  "payment-service/src/app.js",
  "review-service/src/app.js",
  "service-service/src/app.js",
  "staff-service/src/app.js",
  "api-gateway/src/app.js",
]
const children = services.map((entry) => {
  const child = spawn(process.execPath, [path.join(root, entry)], { cwd: root, stdio: "inherit", env: process.env })
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`${entry} exited unexpectedly (${signal || code}).`)
      shutdown(code || 1)
    }
  })
  return child
})
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM")
  process.exitCode = code
}

process.on("SIGINT", () => shutdown())
process.on("SIGTERM", () => shutdown())
