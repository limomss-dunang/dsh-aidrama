/**
 * 对已存在项目跑「编译 → 校验 → 导出」，不改动项目结构。
 * 用法：node scripts/check-project.mjs <sessionId> <projectId> [dialect]
 */
const BASE = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:51469'
const [sessionId, projectId, dialect = 'seedance-2.5'] = process.argv.slice(2)
if (sessionId === undefined || projectId === undefined) {
  console.error('用法：node scripts/check-project.mjs <sessionId> <projectId> [dialect]')
  process.exit(2)
}
async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const envelope = await response.json()
  if (envelope.ok !== true) throw new Error(`${path}: ${envelope.error}`)
  return envelope.value
}
const session = await post('/api/dsh-aidrama/session', { sessionId })
const project = (await post('/api/dsh-aidrama/validate', { cwd: session.cwd, projectId })).project
const episode = project.episodes[0]
if (episode === undefined) throw new Error('项目没有分集')
const compiled = await post('/api/dsh-aidrama/compile', {
  cwd: session.cwd, projectId, episodeId: episode.id, dialect, expectedRevision: project.revision,
})
console.log('compiled =', compiled.compiled)
const validation = await post('/api/dsh-aidrama/validate', { cwd: session.cwd, projectId, episodeId: episode.id })
console.log('validation =', validation.validation.errors, 'error /', validation.validation.warns, 'warn')
for (const finding of validation.validation.findings) console.log(`  [${finding.level}] ${finding.ruleId} ${finding.message}`)
const shot = compiled.project.episodes[0].shots[0]
if (shot !== undefined) console.log('\nfirst prompt:\n' + shot.prompt.text)
const exported = await post('/api/dsh-aidrama/export', { cwd: session.cwd, projectId })
console.log('\nexported =', exported.dir, exported.files.length, 'files')
