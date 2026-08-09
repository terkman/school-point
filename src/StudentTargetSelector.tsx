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
      <div className="score-action-options" role="group" aria-label="ประเภทการจัดการคะแนน">
        <button type="button" disabled={disabled} className={value === 'deduction' ? 'deduction active' : 'deduction'} aria-pressed={value === 'deduction'} onClick={() => onChange('deduction')}>
          <strong>ตัดคะแนน</strong><span>บันทึกการกระทำผิดระเบียบ</span>
        </button>
        <button type="button" disabled={disabled} className={value === 'addition' ? 'addition active' : 'addition'} aria-pressed={value === 'addition'} onClick={() => onChange('addition')}>
          <strong>เพิ่มคะแนน</strong><span>กิจกรรมหรือพฤติกรรมเชิงบวก</span>
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
  const selectedIds = value.scope === 'single'
    ? new Set(value.singleStudentId ? [value.singleStudentId] : [])
    : value.scope === 'classroom'
      ? new Set(roomStudents.map((student) => student.id))
      : value.selectedStudentIds
  const targets = resolveStudentTargets(students, value)
  const allVisibleSelected = visibleStudents.length > 0
    && visibleStudents.every((student) => selectedIds.has(student.id))

  function selectGrade(gradeLevel: string) {
    const firstClassroom = classrooms.find((classroom) => classroom.gradeLevel === gradeLevel)
    onChange({
      ...value,
      scope: 'selected',
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
      scope: 'selected',
      classroomId,
      singleStudentId: classroom?.students[0]?.id ?? '',
      selectedStudentIds: new Set(),
    })
    setQuery('')
  }

  function toggleStudent(studentId: string) {
    const nextIds = new Set(selectedIds)
    if (nextIds.has(studentId)) nextIds.delete(studentId)
    else nextIds.add(studentId)
    onChange({ ...value, scope: 'selected', singleStudentId: studentId, selectedStudentIds: nextIds })
  }

  function toggleVisibleStudents() {
    const nextIds = new Set(selectedIds)
    for (const student of visibleStudents) {
      if (allVisibleSelected) nextIds.delete(student.id)
      else nextIds.add(student.id)
    }
    onChange({ ...value, scope: 'selected', selectedStudentIds: nextIds })
  }

  return (
    <section className="target-selector" aria-label={`เลือกนักเรียนสำหรับ${actionLabel}`}>
      <div className="target-selector-heading">
        <div><p className="eyebrow">ขั้นตอนที่ {stepStart} จาก 3</p><h2>เลือกนักเรียน</h2></div>
        <span>เลือกแล้ว <strong>{targets.length}</strong> คน</span>
      </div>
      <label className="search-label selector-search-label">
        <span className="sr-only">ค้นหานักเรียนในห้อง</span>
        <input disabled={disabled} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือรหัสนักเรียนในห้องนี้" />
      </label>
      <div className="selection-path">
        <label>
          <span>ระดับชั้น</span>
          <select disabled={disabled || !grades.length} value={value.gradeLevel} onChange={(event) => selectGrade(event.target.value)}>
            {grades.length
              ? grades.map((grade) => <option key={grade.id} value={grade.id}>{grade.label}</option>)
              : <option value="">ยังไม่มีชั้นในสิทธิ์</option>}
          </select>
        </label>
        <label>
          <span>ห้องเรียน</span>
          <select disabled={disabled || !gradeClassrooms.length} value={value.classroomId} onChange={(event) => selectClassroom(event.target.value)}>
            {gradeClassrooms.length
              ? gradeClassrooms.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name} • {classroom.students.length} คน</option>)
              : <option value="">ยังไม่มีห้องในสิทธิ์</option>}
          </select>
        </label>
      </div>

      {!grades.length ? (
        <div className="selection-empty-state" role="status">
          <strong>ยังเลือกชั้น ห้อง และรายชื่อนักเรียนไม่ได้</strong>
          <span>{emptyDetail ?? 'ยังไม่มีนักเรียนหรือห้องเรียนที่เปิดใช้งานในภาคเรียนนี้'}</span>
        </div>
      ) : (
        <div className="picker-panel">
          <div className="picker-toolbar">
            <label className="select-all-row">
              <input type="checkbox" disabled={disabled || !visibleStudents.length} checked={allVisibleSelected} onChange={toggleVisibleStudents} />
              <span>{normalizedQuery ? 'เลือกทั้งหมดที่ค้นพบ' : 'เลือกทั้งหมดในห้องนี้'}</span>
              <small>{visibleStudents.length} คน</small>
            </label>
          </div>
          <div className="picker-list" aria-label="รายชื่อนักเรียน">
            {visibleStudents.length ? visibleStudents.map((student) => (
              <label className={selectedIds.has(student.id) ? 'picker-check-row selected student-list-item' : 'picker-check-row student-list-item'} key={student.id}>
                <input type="checkbox" disabled={disabled} checked={selectedIds.has(student.id)} onChange={() => toggleStudent(student.id)} />
                <span className="student-avatar">{student.name.slice(-2)}</span>
                <span><strong>{student.name}</strong><small>{student.studentCode} • {student.classroomName}</small></span>
                <b>{student.score}<small> คะแนน</small></b>
              </label>
            )) : <p className="picker-empty">ไม่พบนักเรียนตามคำค้น</p>}
          </div>
        </div>
      )}
    </section>
  )
}
