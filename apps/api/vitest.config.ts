import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // DB 통합 테스트는 daily_test 데이터베이스 하나를 공유한다.
    // 파일을 병렬로 돌리면 한 파일의 resetDb()가 실행 중인 다른 파일의 행을
    // TRUNCATE로 지워버린다. 증상은 "혼자 돌리면 통과, 전체로 돌리면 실패"다.
    fileParallelism: false,
  },
})
