import { execFileSync } from 'node:child_process'

/**
 * Test-only helper for environments without a readable mailbox (production): confirms the e-mail address of a
 * throwaway E2E account directly in the database via sqlcmd. Only addresses on the reserved test domain
 * @e2e.gastroteam.example can be confirmed. Requires E2E_SQL_SERVER, E2E_SQL_DB, E2E_SQL_USER, E2E_SQL_PASSWORD.
 */
export function confirmTestAccount(email: string): boolean {
  const { E2E_SQL_SERVER: server, E2E_SQL_DB: db, E2E_SQL_USER: user, E2E_SQL_PASSWORD: password } = process.env
  if (!server || !db || !user || !password) return false
  if (!/^[a-z0-9.-]+@e2e\.gastroteam\.example$/i.test(email)) throw new Error('Only E2E test accounts may be confirmed')
  const sql = `SET NOCOUNT ON; UPDATE AspNetUsers SET EmailConfirmed = 1 WHERE NormalizedEmail = UPPER('${email}') AND NormalizedEmail LIKE '%@E2E.GASTROTEAM.EXAMPLE'; SELECT @@ROWCOUNT;`
  const out = execFileSync('sqlcmd', ['-S', server, '-d', db, '-U', user, '-C', '-I', '-h', '-1', '-W', '-Q', sql], { env: { ...process.env, SQLCMDPASSWORD: password } })
  return out.toString().trim().endsWith('1')
}
