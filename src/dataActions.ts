export type DeductionScope = 'single' | 'selected' | 'classroom'

export interface RecordDeductionsInput {
  clientRequestId: string
  scope: DeductionScope
  studentIds: string[]
  classroomId?: string
  ruleId: string
  occurredAt: string
  studentVisibleNote?: string
  internalNote: string
  confirmSeriousBulk: boolean
}

export interface DeductionStudentResult {
  studentId: string
  incidentId: string
  requestedPoints: number
  appliedPoints: number
  balanceBefore: number
  balanceAfter: number
}

export interface RecordDeductionsResult {
  ok: boolean
  replayed: boolean
  batchId: string
  scope: DeductionScope
  classroomId?: string
  targetCount: number
  requestedPointsEach: number
  totalRequestedPoints?: number
  totalAppliedPoints: number
  alreadyAtZeroCount: number
  guardianTaskCount: number
  results: DeductionStudentResult[]
}

export interface RequestPointAdditionInput {
  clientRequestId: string
  studentId: string
  positiveRuleId: string
  points: number
  activityOccurredAt: string
  reason: string
  evidenceNote: string
}

export interface SubmitAppealInput {
  incidentId: string
  reason: string
}

export interface ReviewPointAdditionInput {
  requestId: string
  approve: boolean
  note?: string
}

export interface ReviewAppealInput {
  appealId: string
  accept: boolean
  note: string
}

export interface AdminAddPointsInput {
  clientRequestId: string
  studentId: string
  positiveRuleId: string
  points: number
  activityOccurredAt: string
  reason: string
  evidenceNote: string
  termId: string
}

export interface AdminAddPointsResult {
  ok: boolean
  replayed: boolean
  ledgerId: string
  studentId: string
  requestedPoints: number
  appliedPoints: number
  balanceBefore: number
  balanceAfter: number
}

export interface UpdateTermScheduleInput {
  termId: string
  startsOn: string
  endsOn: string
}

export interface AppDataActions {
  recordDeductions: (input: RecordDeductionsInput) => Promise<RecordDeductionsResult>
  requestPointAddition: (input: RequestPointAdditionInput) => Promise<void>
  submitAppeal: (input: SubmitAppealInput) => Promise<void>
  reviewPointAddition: (input: ReviewPointAdditionInput) => Promise<void>
  reviewAppeal: (input: ReviewAppealInput) => Promise<void>
  adminAddPoints: (input: AdminAddPointsInput) => Promise<AdminAddPointsResult>
  initializeTermScores: (termId: string) => Promise<void>
  updateTermSchedule: (input: UpdateTermScheduleInput) => Promise<void>
}
