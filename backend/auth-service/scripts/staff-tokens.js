import { testBase, testAccounts, loginAccounts, saveTokens } from './http-tools.js'
try {
  const tokens = await loginAccounts(testBase(), await testAccounts())
  await saveTokens(tokens)
  console.log(JSON.stringify({ event: 'real_auth_tokens_saved', identities: ['A', 'B', 'CUSTOMER'], directory: 'secrets/tokens', tokenContentsPrinted: false }))
} catch { console.error('Could not obtain real Auth tokens; review service/configuration/test credentials. No secrets were printed.'); process.exitCode = 1 }
