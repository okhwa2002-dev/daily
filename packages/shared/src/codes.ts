export const EXPENSE_KIND = ['INCOME', 'EXPENSE'] as const
export type ExpenseKind = (typeof EXPENSE_KIND)[number]

export const WORKOUT_KIND = ['STRENGTH', 'CARDIO', 'ETC'] as const
export type WorkoutKind = (typeof WORKOUT_KIND)[number]

export const BODY_PART = [
  'CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'FULL_BODY',
] as const
export type BodyPart = (typeof BODY_PART)[number]

export const INTENSITY = ['LOW', 'MID', 'HIGH'] as const
export type Intensity = (typeof INTENSITY)[number]

export const MEAL_SLOT = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'] as const
export type MealSlot = (typeof MEAL_SLOT)[number]

export const PORTION = ['LIGHT', 'NORMAL', 'HEAVY'] as const
export type Portion = (typeof PORTION)[number]

export const BOOK_STATUS = ['READING', 'DONE', 'WISHLIST'] as const
export type BookStatus = (typeof BOOK_STATUS)[number]

export const USER_STATUS = ['ACTIVE', 'SUSPENDED', 'PENDING_DELETION'] as const
export type UserStatus = (typeof USER_STATUS)[number]

export const OUTBOX_OP = ['UPSERT', 'DELETE'] as const
export type OutboxOp = (typeof OUTBOX_OP)[number]

export const SYNC_RESULT = ['APPLIED', 'STALE', 'CONFLICT', 'REJECTED'] as const
export type SyncResult = (typeof SYNC_RESULT)[number]

/** 코드값 규칙 검증용 — 새 코드 그룹을 추가하면 여기에도 넣는다. */
export const ALL_CODES: readonly string[] = [
  ...EXPENSE_KIND, ...WORKOUT_KIND, ...BODY_PART, ...INTENSITY,
  ...MEAL_SLOT, ...PORTION, ...BOOK_STATUS, ...USER_STATUS,
  ...OUTBOX_OP, ...SYNC_RESULT,
]
