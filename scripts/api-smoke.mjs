// API smoke test: captures the observable behavior of the server so that
// refactors can be verified against a recorded baseline.
//
// Usage:
//   node scripts/api-smoke.mjs [baseUrl] > result.json
//   node scripts/api-smoke.mjs            (defaults to http://localhost:3001)

const BASE = process.argv[2] || 'http://localhost:3001'

const results = []

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g

function normalize(value) {
  if (typeof value === 'string') {
    if (value.split('.').length === 3 && value.length > 100) return '<TOKEN>'
    return value.replace(UUID_RE, '<UUID>').replace(ISO_DATE_RE, '<DATE>')
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = normalize(value[key])
    return out
  }
  return value
}

async function call(name, method, path, { body, token, raw, pick } = {}) {
  const headers = {}
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    json = '<non-json>'
  }
  results.push({ name, status: res.status, body: normalize(pick ? pick(json) : json) })
  return json
}

const titles = (j) => ({ ...j, data: { ...j.data, recipes: (j.data?.recipes ?? []).map((r) => r.title) } })
const searchTitles = (j) => ({ ...j, data: (j.data ?? []).map((r) => r.title) })
const feedTitles = (j) => ({ ...j, data: (j.data ?? []).map((r) => r.title) })
const userRecipes = (j) => ({ ...j, data: { ...j.data, recipes: (j.data?.recipes ?? []).map((r) => r.title) } })

async function main() {
  await call('health', 'GET', '/api/health')

  // ---- auth ----
  await call('register-missing-password', 'POST', '/api/user/register', { body: { username: 'smoke_chef' } })
  await call('register-short-password', 'POST', '/api/user/register', { body: { username: 'smoke_chef', password: '123' } })
  const regA = await call('register-chef', 'POST', '/api/user/register', {
    body: { username: 'smoke_chef', password: 'secret123', email: 'chef@smoke.test' },
  })
  await call('register-duplicate-username', 'POST', '/api/user/register', { body: { username: 'smoke_chef', password: 'secret123' } })
  await call('register-duplicate-email', 'POST', '/api/user/register', {
    body: { username: 'smoke_other', password: 'secret123', email: 'chef@smoke.test' },
  })
  await call('login-missing-password', 'POST', '/api/user/login', { body: { username: 'smoke_chef' } })
  await call('login-unknown-user', 'POST', '/api/user/login', { body: { username: 'ghost', password: 'secret123' } })
  await call('login-wrong-password', 'POST', '/api/user/login', { body: { username: 'smoke_chef', password: 'nope123' } })
  const loginA = await call('login-chef', 'POST', '/api/user/login', { body: { username: 'smoke_chef', password: 'secret123' } })
  await call('login-malformed-json', 'POST', '/api/user/login', { raw: '{\\' })

  const regB = await call('register-fan', 'POST', '/api/user/register', { body: { username: 'smoke_fan', password: 'secret123' } })

  const tokenA = loginA.data.token
  const tokenB = regB.data.token
  const chefId = regA.data.user.id
  const fanId = regB.data.user.id

  // ---- recipe browsing ----
  await call('recipe-list-page1', 'GET', '/api/recipe?page=1&limit=5', { pick: titles })
  await call('recipe-list-invalid-page', 'GET', '/api/recipe?page=0')
  await call('recipe-list-invalid-limit', 'GET', '/api/recipe?limit=101')
  await call('recipe-search-empty', 'GET', '/api/recipe/search?q=')
  await call('recipe-search', 'GET', '/api/recipe/search?q=' + encodeURIComponent('豆腐'), { pick: searchTitles })

  // ---- recipe creation ----
  const validRecipe = {
    title: 'Smoke Test Recipe',
    coverImage: 'https://example.com/cover.jpg',
    ingredients: [{ name: 'salt', quantity: 1, unit: 'g' }],
    steps: [{ order: 1, description: 'mix' }],
    cookTime: 10,
    difficulty: 2,
    tags: ['test'],
  }
  await call('recipe-create-unauthorized', 'POST', '/api/recipe', { body: validRecipe })
  await call('recipe-create-missing-fields', 'POST', '/api/recipe', { token: tokenA, body: { title: 'x' } })
  await call('recipe-create-empty-ingredients', 'POST', '/api/recipe', {
    token: tokenA,
    body: { ...validRecipe, ingredients: [] },
  })
  await call('recipe-create-empty-steps', 'POST', '/api/recipe', { token: tokenA, body: { ...validRecipe, steps: [] } })
  const created = await call('recipe-create', 'POST', '/api/recipe', { token: tokenA, body: validRecipe })
  const recipeId = created.data.id

  await call('recipe-get', 'GET', `/api/recipe/${recipeId}`)
  await call('recipe-get-not-found', 'GET', '/api/recipe/does-not-exist')

  // ---- interactions ----
  await call('like-unauthorized', 'POST', `/api/recipe/${recipeId}/like`)
  await call('like', 'POST', `/api/recipe/${recipeId}/like`, { token: tokenB })
  await call('like-again', 'POST', `/api/recipe/${recipeId}/like`, { token: tokenB })
  await call('like-not-found', 'POST', '/api/recipe/nope/like', { token: tokenB })
  await call('favorite', 'POST', `/api/recipe/${recipeId}/favorite`, { token: tokenB })
  await call('comment-empty', 'POST', `/api/recipe/${recipeId}/comment`, { token: tokenB, body: { content: '  ' } })
  await call('comment', 'POST', `/api/recipe/${recipeId}/comment`, { token: tokenB, body: { content: 'smoke comment' } })
  await call('comment-not-found', 'POST', '/api/recipe/nope/comment', { token: tokenB, body: { content: 'hi' } })

  // ---- social ----
  await call('follow-missing-user-id', 'POST', '/api/user/follow', { token: tokenB, body: {} })
  await call('follow-self', 'POST', '/api/user/follow', { token: tokenA, body: { userId: chefId } })
  await call('follow-not-found', 'POST', '/api/user/follow', { token: tokenB, body: { userId: 'nope' } })
  await call('follow', 'POST', '/api/user/follow', { token: tokenB, body: { userId: chefId } })

  // WebSocket: authenticate as the fan, then have the chef publish a recipe.
  const wsMessages = await new Promise((resolve) => {
    const received = []
    const ws = new WebSocket(BASE.replace(/^http/, 'ws'))
    const done = () => {
      try { ws.close() } catch { /* ignore */ }
      resolve(received)
    }
    const timer = setTimeout(done, 3000)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      received.push(msg.type === 'NEW_RECIPE' ? { type: msg.type, authorName: msg.payload.authorName } : { type: msg.type })
      if (msg.type === 'AUTH_SUCCESS') {
        call('recipe-create-for-broadcast', 'POST', '/api/recipe', {
          token: tokenA,
          body: { ...validRecipe, title: 'Broadcast Recipe' },
        }).then(() => setTimeout(done, 1000))
      }
    }
    ws.onerror = () => { clearTimeout(timer); done() }
    ws.onopen = () => ws.send(JSON.stringify({ type: 'AUTH', payload: { userId: fanId } }))
  })
  results.push({ name: 'ws-notifications', status: 200, body: normalize(wsMessages) })

  await call('feed', 'GET', '/api/user/feed', { token: tokenB, pick: feedTitles })
  await call('feed-unauthorized', 'GET', '/api/user/feed')
  await call('unfollow', 'POST', '/api/user/unfollow', { token: tokenB, body: { userId: chefId } })
  await call('unfollow-not-found', 'POST', '/api/user/unfollow', { token: tokenB, body: { userId: 'nope' } })
  await call('user-get', 'GET', `/api/user/${chefId}`, { pick: userRecipes })
  await call('user-get-not-found', 'GET', '/api/user/nope')
  await call('route-not-found', 'GET', '/api/nope')

  console.log(JSON.stringify(results, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
