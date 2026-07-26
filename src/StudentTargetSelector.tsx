import { useMemo, useState } from 'react'
import type { Student } from './domain'
import {
  buildClassroomGroups,
  resolveStudentTargets,
  type StudentTargetSelection,
} from './studentSelection'

interface StudentTargetSelectorProps {
  students: Student[]
  value: StudentTargetSelection
  onChange: (next: StudentTargetSelection) => void
  disabled: boolean
  actionLabel: 'ตัดคะแนน' | 'หักคะแนน' | 'เพิ่มคะแนน'
  stepStart?: number
  emptyDetail?: string
}

export type ScoreAction = 'addition' | 'deduction'

export function ScoreActionSelector({
  value,
  onChange,
  disabled,
}: {
  value: ScoreAction
  onChange: (next: ScoreAction) => void
  disabled: boolean
}) {
  return (
    <section className="score-action-selector" aria-label="เลือกว่าจะเพิ่มหรือตัดคะแนน">
      <div className="selection-step-heading action-step-heading">
        <span><b>1</b> เลือกงานที่ต้องการทำ</span>
        <small>เลือกก่อนระบุชั้น ห้อง และรายชื่อนักเรียน</small>
      </div>
      <div className="score-action-options" role="group" aria-label="ประเภทการจัดการคะแนน">
        <button type="button" disabled={disabled} className={value === 'addition' ? 'addition active' : 'addition'} aria-pressed={value === 'addition'} onClick={() => onChange('addition')}>
          <strong>เพิ่มคะแนน</strong><span>กิจกรรมหรือพฤติกรรมเชิงบวก</span>
        </button>
        <button type="button" disabled={disabled} className={value === 'deduction' ? 'deduction active' : 'deduction'} aria-pressed={value === 'deduction'} onClick={() => onChange('deduction')}>
          <strong>ตัดคะแนน</strong><span>บันทึกการกระทำผิดระเบียบ</span>
        </button>
      </div>
    </section>
  )
}

export function StudentTargetSelector({
  students,
  value,
  onChange,
  disabled,
  actionLabel,
  stepStart = 1,
  emptyDetail,
}: StudentTargetSelectorProps) {
  const [query, setQuery] = useState('')
  const classrooms = useMemo(() => buildClassroomGroups(students), [students])
  const grades = useMemo(() => {
    const unique = new Map<string, string>()
    for (const classroom of classrooms) unique.set(classroom.gradeLevel, classroom.gradeLabel)
    return [...unique].map(([id, label]) => ({ id, label }))
  }, [classrooms])
  const gradeClassrooms = classrooms.filter((classroom) => classroom.gradeLevel === value.gradeLevel)
  const selectedClassroom = gradeClassrooms.find((classroom) => classroom.id === value.classroomId)
  const roomStudents = selectedClassroom?.students ?? []
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const visibleStudents = normalizedQuery
    ? roomStudents.filter((student) => `${student.studentCode} ${student.name}`.toLocaleLowerCase('th').includes(normalizedQuery))
    : roomStudents
  const targets = resolveStudentTargets(students, value)
  const allVisibleSelected = visibleStudents.length > 0
    && visibleStudents.every((student) => value.selectedStudentIds.has(student.id))

  function selectGrade(gradeLevel: string) {
    const firstClassroom = classrooms.find((classroom) => classroom.gradeLevel === gradeLevel)
    onChange({
      ...value,
      gradeLevel,
      classroomId: firstClassroom?.id ?? '',
      singleStudentId: firstClassroom?.students[0]?.id ?? '',
      selectedStudentIds: new Set(),
    })
    setQuery('')
  }

  function selectClassroom(classroomId: string) {
    const classroom = classrooms.find((item) => item.id === classroomId)
    onChange({
      ...value,
      classroomId,
      singleStudentId: classroom?.students[0]?.id ?? '',
      selectedStudentIds: new Set(),
    })
    setQuery('')
  }

  function selectScope(scope: StudentTargetSelection['scope']) {
    onChange({
      ...value,
      scope,
      singleStudentId: value.singleStudentId || roomStudents[0]?.id || '',
      selectedStudentIds: scope === 'selected' ? new Set(value.selectedStudentIds) : new Set(),
    })
  }

  function toggleStudent(studentId: string) {
    const nextIds = new Set(value.selectedStudentIds)
    if (nextIds.has(studentId)) nextIds.delete(studentId)
    else nextIds.add(studentId)
    onChange({ ...value, selectedStudentIds: nextIds })
  }

  function toggleVisibleStudents() {
    const nextIds = new Set(value.selectedStudentIds)
    for (const student of visibleStudents) {
      if (allVisibleSelected) nextIds.delete(student.id)
      else nextIds.add(student.id)
    }
    onChange({ ...value, selectedStudentIds: nextIds })
  }

  return (
    <section className="target-selector" aria-label={`เลือกนักเรียนสำหรับ${actionLabel}`}>
      <div className="selection-path">
        <label>
          <span><b>{stepStart}</b> เลือกชั้น</span>
          <select disabled={disabled || !grades.length} value={value.gradeLevel} onChange={(event) => selectGrade(event.target.value)}>
            {grades.length
              ? grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)
              : <option value="">ยังไม่มีชั้นในสิทธิ์</option>}
          </select>
        </label>
        <label>
          <span><b>{stepStart + 1}</b> เลือกห้อง</span>
          <select disabled={disabled || !gradeClassrooms.length} value={value.classroomId} onChange={(event) => selectClassroom(event.target.value)}>
            {gradeClassrooms.length
              ? gradeClassrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} • {classroom.students.length} คน</option>)
              : <option value="">ยังไม่มีห้องในสิทธิ์</option>}
          </select>
        </label>
      </div>

      <div className="selection-step-heading"><span><b>{stepStart + 2}</b> เลือกขอบเขต</span><small>{selectedClassroom?.name ?? 'ยังไม่มีห้องเรียน'} • เลือกแล้ว {targets.length} คน</small></div>
      <div className="scope-switch compact-scope" role="group" aria-label="รูปแบบการเลือกนักเรียน">
        <button type="button" disabled={disabled || !roomStudents.length} className={value.scope === 'single' ? 'active' : ''} aria-pressed={value.scope === 'single'} onClick={() => selectScope('single')}><strong>รายคน</strong><span>เลือก 1 คน</span></button>
        <button type="button" disabled={disabled || !roomStudents.length} className={value.scope === 'selected' ? 'active' : ''} aria-pressed={value.scope === 'selected'} onClick={() => selectScope('selected')}><strong>เฉพาะกลุ่ม</strong><span>เลือกหลายคน</span></button>
        <button type="button" disabled={disabled || !roomStudents.length} className={value.scope === 'classroom' ? 'active' : ''} aria-pressed={value.scope === 'classroom'} onClick={() => selectScope('classroom')}><strong>ทั้งห้อง</strong><span>{roomStudents.length} คน</span></button>
      </div>

      {!grades.length ? (
        <div className="selection-empty-state" role="status">
          <strong>ยังเลือกชั้น ห้อง และขอบเขตไม่ได้</strong>
          <span>{emptyDetail ?? 'ยังไม่มีนักเรียนหรือห้องเรียนที่เปิดใช้งานในภาคเรียนนี้'}</span>
        </div>
      ) : value.scope === 'classroom' ? (
        <div className="picker-panel classroom-picker">
          <div className="picker-heading"><strong>{selectedClassroom?.name ?? 'ยังไม่เลือกห้อง'}</strong><small>ระบบจะตรวจรายชื่อทั้งห้องอีกครั้งตอนบันทึก</small></div>
          <div className="classroom-roster">
            {roomStudents.map((student) => (
              <div className="roster-row student-list-item" key={student.id}>
                <span><strong>{student.name}</strong><small>{student.studentCode}</small></span>
                <b>{student.score}</b>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="picker-panel">
          <label className="search-label">
            <span className="sr-only">ค้นหานักเรียนในห้อง</span>
            <input disabled={disabled} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือรหัสนักเรียนในห้องนี้" />
          </label>
          {value.scope === 'selected' ? (
            <div className="picker-toolbar">
              <span>เลือกแล้ว <strong>{value.selectedStudentIds.size}</strong> คน</span>
              <button type="button" className="text-button" disabled={disabled || !visibleStudents.length} onClick={toggleVisibleStudents}>
                {allVisibleSelected ? 'ยกเลิกที่ค้นพบ' : 'เลือกที่ค้นพบทั้งหมด'}
              </button>
            </div>
          ) : null}
          <div className="picker-list" role={value.scope === 'single' ? 'listbox' : undefined} aria-label="รายชื่อนักเรียน">
            {visibleStudents.length ? visibleStudents.map((student) => value.scope === 'single' ? (
              <button
                type="button"
                key={student.id}
                className={student.id === value.singleStudentId ? 'picker-row selected student-list-item' : 'picker-row student-list-item'}
                onClick={() => onChange({ ...value, singleStudentId: student.id })}
                role="option"
                aria-selected={student.id === value.singleStudentId}
                disabled={disabled}
              >
                <span className="student-avatar">{student.name.slice(-2)}</span>
                <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
                <b>{student.score}</b>
              </button>
            ) : (
              <label className={value.selectedStudentIds.has(student.id) ? 'picker-check-row selected student-list-item' : 'picker-check-row student-list-item'} key={student.id}>
                <input type="checkbox" disabled={disabled} checked={value.selectedStudentIds.has(student.id)} onChange={() => toggleStudent(student.id)} />
                <span className="student-avatar">{student.name.slice(-2)}</span>
                <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
                <b>{student.score}</b>
              </label>
            )) : <p className="picker-empty">ไม่พบนักเรียนตามคำค้น</p>}
          </div>
        </div>
      )}
    </section>
  )
}
