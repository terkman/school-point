import type {
  GuardianContact,
  GuardianContactChannel,
  GuardianContactOutcome,
} from './domain'
import type { EvidenceAttachment } from './evidence'
import type {
  PaperDocumentEventType,
  PaperDocumentStatus,
  PaperDocumentType,
} from './adminDomain'
import type { SchoolImportPreview, SchoolImportResult } from './schoolImport'
import type {
  ActivationCodeResult,
  CreateSchoolClassroomInput,
  CreateSchoolClassroomResult,
  CreateSchoolPersonInput,
  CreateSchoolPersonResult,
  PasswordResetCodeResult,
  PasswordResetInput,
  SchoolDirectorySnapshot,
  UpdateSchoolStaffInput,
  UpdateSchoolStudentInput,
} from './schoolDirectory'

/** A write completed on the server, but the follow-up screen refresh did not. */
export interface MutationSyncWarning {
  code: 'refresh_failed'
  message: string
}

export type MutationResult<T extends object> = T & {
  syncWarning?: MutationSyncWarning
}

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
  syncWarning?: MutationSyncWarning
}

export interface RequestDeductionsResult {
  ok: boolean
  replayed: boolean
  batchId: string
  scope: DeductionScope
  classroomId?: string
  targetCount: number
  requestedPointsEach: number
  requests: Array<{ studentId: string; requestId: string; status: 'pending' }>
  syncWarning?: MutationSyncWarning
}

export interface ReviewDeductionInput {
  requestId: string
  approve: boolean
  approvedPoints: number
  note?: string
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
  syncWarning?: MutationSyncWarning
}

export interface SubmitAppealInput {
  incidentId: string
  reason: string
}

export interface ReviewPointAdditionInput {
  requestId: string
  approve: boolean
  approvedPoints: number
  note?: string
}

export interface ReviewAppealInput {
  appealId: string
  restoredPoints: number
  note: string
}

export interface ReopenAppealInput {
  appealId: string
  reason: string
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
  syncWarning?: MutationSyncWarning
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
  syncWarning?: MutationSyncWarning
}

export interface AdminAdjustScoreInput {
  clientRequestId: string
  studentId: string
  delta: number
  occurredAt: string
  reason: string
  termId: string
}

export interface AdminAdjustScoreResult {
  ok: boolean
  replayed: boolean
  ledgerId: string
  studentId: string
  requestedDelta: number
  appliedDelta: number
  balanceBefore: number
  balanceAfter: number
  syncWarning?: MutationSyncWarning
}

export interface CreateBehaviorRuleInput {
  title: string
  points: number
  description?: string
}

export interface CreatePositiveRuleInput {
  title: string
  points: number
  discretionary: boolean
  description?: string
}

export interface CreateRuleResult {
  ok: boolean
  id: string
  code: string
  syncWarning?: MutationSyncWarning
}

export interface RemoveRuleResult {
  ok: boolean
  outcome: 'deleted' | 'archived'
  syncWarning?: MutationSyncWarning
}

export interface ProposeRuleInput {
  kind: 'deduction' | 'positive'
  title: string
  points: number
  description?: string
  discretionary?: boolean
}

export interface UpdateBehaviorRuleInput extends CreateBehaviorRuleInput {
  ruleId: string
}

export interface UpdatePositiveRuleInput extends CreatePositiveRuleInput {
  ruleId: string
}

export interface ReviewRuleProposalInput {
  proposalId: string
  approve: boolean
  note?: string
}

export interface SetTeacherSchoolwideScoringInput {
  teacherUserId: string
  termId: string
  enabled: boolean
  grantId?: string
  reason: string
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

export interface RecordGuardianContactAttemptInput {
  /**
   * Stable across retries of the same submitted contact attempt. Callers that
   * do not supply one receive a fresh ID for this action invocation.
   */
  clientRequestId?: string
  taskId: string
  channel: GuardianContactChannel
  outcome: GuardianContactOutcome
  note?: string
  evidenceNote?: string
}

export interface RecordGuardianContactAttemptResult {
  ok: boolean
  attemptId: string
  taskId: string
  status: 'pending' | 'completed'
  closesNotification: boolean
  attemptedAt: string
  nextReminderAt?: string
  syncWarning?: MutationSyncWarning
}

export interface PaperDocumentSnapshot {
  student: {
    id: string
    code: string
    name: string
    classroomName: string
    gradeLevel?: string
    roomNumber?: string
  }
  term: {
    id: string
    schoolYear: number
    semester: number
    name: string
  }
  score: number
  transactions: Array<{
    id: string
    occurredAt: string
    reason: string
    appliedDelta: number
    scoreBefore: number
    scoreAfter: number
  }>
  incident?: {
    id: string
    occurredAt: string
    reason: string
    appliedPoints: number
    appealDeadline: string
  }
  appeal?: {
    id: string
    incidentId: string
    status: 'submitted' | 'reviewing' | 'accepted' | 'rejected'
    statement: string
    restoredPoints: number
    publicExplanation?: string
    createdAt: string
    decidedAt?: string
  }
}

export interface PaperDocumentRecord {
  id: string
  documentNumber: string
  documentType: PaperDocumentType
  status: PaperDocumentStatus
  studentId: string
  termId: string
  incidentId?: string
  appealId?: string
  issuedAt: string
  snapshot: PaperDocumentSnapshot
}

export interface IssuePaperDocumentInput {
  documentType: PaperDocumentType
  studentId: string
  termId: string
  incidentId?: string
  appealId?: string
}

export interface RecordPaperDocumentEventInput {
  documentId: string
  eventType: PaperDocumentEventType
  note?: string
}

export interface SubmitPaperAppealInput {
  documentId: string
  reason: string
  receivedAt: string
}

export interface AppDataActions {
  uploadEvidenceFiles: (files: File[]) => Promise<EvidenceAttachment[]>
  createEvidenceUrl: (attachment: EvidenceAttachment) => Promise<string>
  recordDeductions: (input: RecordDeductionsInput) => Promise<RecordDeductionsResult>
  requestDeductions: (input: RecordDeductionsInput) => Promise<RequestDeductionsResult>
  reviewDeduction: (input: ReviewDeductionInput) => Promise<void>
  requestPointAddition: (input: RequestPointAdditionInput) => Promise<void>
  requestPointAdditions: (input: RequestPointAdditionsInput) => Promise<RequestPointAdditionsResult>
  submitAppeal: (input: SubmitAppealInput) => Promise<void>
  reviewPointAddition: (input: ReviewPointAdditionInput) => Promise<void>
  reviewAppeal: (input: ReviewAppealInput) => Promise<void>
  reopenAppeal: (input: ReopenAppealInput) => Promise<void>
  adminAddPoints: (input: AdminAddPointsInput) => Promise<AdminAddPointsResult>
  adminAddPointsBulk: (input: AdminAddPointsBulkInput) => Promise<AdminAddPointsBulkResult>
  adminAdjustScore: (input: AdminAdjustScoreInput) => Promise<AdminAdjustScoreResult>
  createBehaviorRule: (input: CreateBehaviorRuleInput) => Promise<CreateRuleResult>
  createPositiveRule: (input: CreatePositiveRuleInput) => Promise<CreateRuleResult>
  proposeRule: (input: ProposeRuleInput) => Promise<{ id: string }>
  reviewRuleProposal: (input: ReviewRuleProposalInput) => Promise<void>
  updateBehaviorRule: (input: UpdateBehaviorRuleInput) => Promise<{ id: string }>
  updatePositiveRule: (input: UpdatePositiveRuleInput) => Promise<{ id: string }>
  removeBehaviorRule: (ruleId: string) => Promise<RemoveRuleResult>
  removePositiveRule: (ruleId: string) => Promise<RemoveRuleResult>
  initializeTermScores: (termId: string) => Promise<void>
  updateTermSchedule: (input: UpdateTermScheduleInput) => Promise<void>
  updateTeacherClassrooms: (input: UpdateTeacherClassroomsInput) => Promise<void>
  setTeacherSchoolwideScoring: (input: SetTeacherSchoolwideScoringInput) => Promise<void>
  getGuardianContacts: (taskId: string) => Promise<GuardianContact[]>
  recordGuardianContactAttempt: (input: RecordGuardianContactAttemptInput) => Promise<RecordGuardianContactAttemptResult>
  completeGuardianContact: (input: CompleteGuardianContactInput) => Promise<void>
  updateFollowUpCase: (input: UpdateFollowUpCaseInput) => Promise<void>
  getPaperDocuments?: (termId: string) => Promise<PaperDocumentRecord[]>
  issuePaperDocument?: (input: IssuePaperDocumentInput) => Promise<PaperDocumentRecord>
  recordPaperDocumentEvent?: (input: RecordPaperDocumentEventInput) => Promise<PaperDocumentRecord>
  submitPaperAppeal?: (input: SubmitPaperAppealInput) => Promise<void>
  setMyAvatarPreset: (preset: string) => Promise<void>
  updateMyNickname: (nickname: string) => Promise<void>
  uploadMyAvatar: (file: File) => Promise<void>
  activateTerm: (termId: string) => Promise<void>
  getSchoolDirectory: () => Promise<SchoolDirectorySnapshot>
  createSchoolClassroom: (input: CreateSchoolClassroomInput) => Promise<CreateSchoolClassroomResult>
  createSchoolPerson: (input: CreateSchoolPersonInput) => Promise<CreateSchoolPersonResult>
  updateSchoolStudent: (input: UpdateSchoolStudentInput) => Promise<void>
  updateSchoolStaff: (input: UpdateSchoolStaffInput) => Promise<void>
  issueActivationCode: (username: string) => Promise<ActivationCodeResult>
  resetSchoolAccountPassword: (input: PasswordResetInput) => Promise<PasswordResetCodeResult>
  previewSchoolImport: (file: File) => Promise<SchoolImportPreview>
  applySchoolImport: (file: File, fingerprint: string) => Promise<SchoolImportResult>
}
