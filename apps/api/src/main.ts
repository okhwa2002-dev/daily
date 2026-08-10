import { buildApp } from './app.ts'
import { env } from './env.ts'

const app = await buildApp()
// nginx는 루프백(127.0.0.1)으로만 이 포트에 붙는다. 더 넓게 바인딩하면
// TLS 없이 API가 외부에 그대로 노출되어 자격증명이 평문으로 오간다.
await app.listen({ port: env.PORT, host: '127.0.0.1' })
