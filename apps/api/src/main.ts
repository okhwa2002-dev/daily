import { buildApp } from './app.ts'
import { env } from './env.ts'

const app = await buildApp()
await app.listen({ port: env.PORT, host: '0.0.0.0' })
