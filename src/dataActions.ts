import type { GuardianContact } from './domain'
import type { EvidenceAttachment } from './evidence'
import type {
  ActivationCodeResult,
  CreateSchoolClassroomInput,
  CreateSchoolClassroomResult,
  CreateSchoolPersonInput,
  CreateSchoolPersonResult,
  SchoolDirectorySnapshot,
  UpdateSchoolStaffInput,
  UpdateSchoolStudentInput,
} from './schoolDirectory'

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

export interface RequestPointAdditionsInput {
  clientRequestId: string
  scope: DeductionScope
  studentIds: string[]
  classroomId: string
  positiveRuleId: string
  points: number
  activityOccurredAt: string
  reason: string
  evidenceNote: string
}

export interface AdditionRequestStudentResult {
  studentId: string
  requestId: string
  status: 'pending'
}

export interface RequestPointAdditionsResult {
  ok: boolean
  replayed: boolean
  batchId: string
  scope: DeductionScope
  classroomId: string
  targetCount: number
  requestedPointsEach: number
  requests: AdditionRequestStudentResult[]
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

export interface AdminAddPointsBulkInput {
  clientRequestId: string
  scope: DeductionScope
  studentIds: string[]
  classroomId: string
  positiveRuleId: string
  points: number
  activityOccurredAt: string
  reason: string
  evidenceNote: string
  termId: string
}

export interface AdminAdditionStudentResult extends AdminAddPointsResult {}

export interface AdminAddPointsBulkResult {
  ok: boolean
  replayed: boolean
  batchId: string
  scope: DeductionScope
  classroomId: string
  targetCount: number
  requestedPointsEach: number
  totalAppliedPoints: number
  results: AdminAdditionStudentResult[]
}

export interface UpdateTermScheduleInput {
  termId: string
  startsOn: string
  endsOn: string
}

export interface UpdateTeacherClassroomsInput {
  termId: string
  teacherId: string
  classroomIds: string[]
}

export interface UpdateFollowUpCaseInput {
  caseId: string
  status: 'following_up' | 'resolved'
  note: string
}

export interface CompleteGuardianContactInput {
  taskId: string
  note: string
}

export interface AppDataActions {
  uploadEvidenceFiles: (files: File[]) => Promise<EvidenceAttachment[]>
  createEvidenceUrl: (attachment: EvidenceAttachment) => Promise<string>
  recordDeductions: (input: RecordDeductionsInput) => Promise<RecordDeductionsResult>
  requestPointAddition: (input: RequestPointAdditionInput) => Promise<void>
  requestPointAdditions: (input: RequestPointAdditionsInput) => Promise<RequestPointAdditionsResult>
  submitAppeal: (input: SubmitAppealInput) => Promise<void>
  reviewPointAddition: (input: ReviewPointAdditionInput) => Promise<void>
  reviewAppeal: (input: ReviewAppealInput) => Promise<void>
  adminAddPoints: (input: AdminAddPointsInput) => Promise<AdminAddPointsResult>
  adminAddPointsBulk: (input: AdminAddPointsBulkInput) => Promise<AdminAddPointsBulkResult>
  initializeTermScores: (termId: string) => Promise<void>
  updateTermSchedule: (input: UpdateTermScheduleInput) => Promise<void>
  updateTeacherClassrooms: (input: UpdateTeacherClassroomsInput) => Promise<void>
  getGuardianContacts: (taskId: string) => Promise<GuardianContact[]>
  completeGuardianContact: (input: CompleteGuardianContactInput) => Promise<void>
  updateFollowUpCase: (input: UpdateFollowUpCaseInput) => Promise<void>
  setMyAvatarPreset: (preset: string) => Promise<void>
  uploadMyAvatar: (file: File) => Promise<void>
  activateTerm: (termId: string) => Promise<void>
  getSchoolDirectory: () => Promise<SchoolDirectorySnapshot>
  createSchoolClassroom: (input: CreateSchoolClassroomInput) => Promise<CreateSchoolClassroomResult>
  createSchoolPerson: (input: CreateSchoolPersonInput) => Promise<CreateSchoolPersonResult>
  updateSchoolStudent: (input: UpdateSchoolStudentInput) => Promise<void>
  updateSchoolStaff: (input: UpdateSchoolStaffInput) => Promise<void>
  issueActivationCode: (username: string) => Promise<ActivationCodeResult>
}
