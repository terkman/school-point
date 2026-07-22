export interface RecordDeductionInput {
  studentId: string
  ruleId: string
  note: string
}

export interface RequestPointAdditionInput {
  studentId: string
  points: number
  reason: string
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
  studentId: string
  points: number
  reason: string
  termId: string
}

export interface UpdateTermScheduleInput {
  termId: string
  startsOn: string
  endsOn: string
}

export interface AppDataActions {
  recordDeduction: (input: RecordDeductionInput) => Promise<void>
  requestPointAddition: (input: RequestPointAdditionInput) => Promise<void>
  submitAppeal: (input: SubmitAppealInput) => Promise<void>
  reviewPointAddition: (input: ReviewPointAdditionInput) => Promise<void>
  reviewAppeal: (input: ReviewAppealInput) => Promise<void>
  adminAddPoints: (input: AdminAddPointsInput) => Promise<void>
  initializeTermScores: (termId: string) => Promise<void>
  updateTermSchedule: (input: UpdateTermScheduleInput) => Promise<void>
}
