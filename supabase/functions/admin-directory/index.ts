import { createClient } from 'npm:@supabase/supabase-js@2.110.2'
import { isActiveDirectoryAdmin } from '../_shared/directoryAuthorization.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
}

const usernamePattern = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/
const gradeLevels = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3'])
const roomNumberPattern = /^[0-9A-Za-zก-๙._-]+$/
const authDomain = 'accounts.school-point.invalid'

type JsonRecord = Record<string, unknown>

function response(status: number, body: JsonRecord) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders })
}

function environmentKey(mapName: string, legacyName: string): string {
  const rawMap = Deno.env.get(mapName)
  if (rawMap) {
    try {
      const values = JSON.parse(rawMap) as Record<string, unknown>
      const value = values.default
      if (typeof value === 'string' && value.trim()) return value
    } catch {
      throw new Error(`การตั้งค่า ${mapName} ไม่ถูกต้อง`)
    }
  }
  return Deno.env.get(legacyName) ?? ''
}

function requiredText(value: unknown, label: string, maxLength = 200): string {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(`กรุณาระบุ${label}`)
  if (text.length > maxLength) throw new Error(`${label}ยาวเกินกำหนด`)
  return text
}

function optionalText(value: unknown, maxLength = 200): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (text.length > maxLength) throw new Error('ข้อความยาวเกินกำหนด')
  return text
}

function usernameValue(value: unknown): string {
  const username = String(value ?? '').trim().toLowerCase()
  if (!usernamePattern.test(username) || username.includes('..')) {
    throw new Error('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด ขีดกลาง และขีดล่าง')
  }
  return username
}

function idValue(value: unknown, label: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label}ไม่ถูกต้อง`)
  return id
}

function optionalId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  return idValue(value, 'รหัสอ้างอิง')
}

function isoDate(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error('วันเกิดไม่ถูกต้อง')
  }
  return text
}

async function generateActivationCode(
  serviceClient: ReturnType<typeof createClient>,
  username: string,
) {
  const email = `${username}@${authDomain}`
  const { data, error } = await serviceClient.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const activationCode = data?.properties?.email_otp
  if (error || !activationCode) {
    throw new Error('สร้างรหัสเปิดใช้ครั้งเดียวไม่สำเร็จ กรุณาลองออกใหม่จากหน้าบัญชี')
  }
  return {
    username,
    activationCode,
    issuedAt: new Date().toISOString(),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response(405, { ok: false, error: 'Method not allowed' })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const publishableKey = environmentKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
    const secretKey = environmentKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !publishableKey || !secretKey) {
      throw new Error('บริการจัดการบัญชียังตั้งค่าไม่ครบ')
    }

    const authorization = request.headers.get('Authorization') ?? ''
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
    if (!accessToken) return response(401, { ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' })

    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    const serviceClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken)
    if (userError || !userData.user) {
      return response(401, { ok: false, error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' })
    }

    const body = await request.json() as JsonRecord
    const action = String(body.action ?? '')
    const input = body.input && typeof body.input === 'object' ? body.input as JsonRecord : {}

    if (action === 'snapshot') {
      const { data, error } = await userClient.rpc('school_directory_snapshot')
      if (error) throw new Error(error.message)
      return response(200, { ok: true, data })
    }

    // Authorize the caller with their own JWT-bound client. The secret-key
    // client is reserved for the privileged operation after this check.
    const { data: profile, error: profileError } = await userClient
      .from('profiles')
      .select('role,is_active,activation_required')
      .eq('user_id', userData.user.id)
      .maybeSingle()
    if (profileError) {
      console.error('admin profile lookup failed', profileError)
      return response(500, {
        ok: false,
        error: 'ตรวจสอบสิทธิ์ผู้ดูแลระบบไม่สำเร็จ กรุณาลองใหม่',
      })
    }
    if (!isActiveDirectoryAdmin(profile)) {
      return response(403, { ok: false, error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขข้อมูลนี้ได้' })
    }

    if (action === 'create-classroom') {
      const gradeLevel = String(input.gradeLevel ?? '').trim().toUpperCase()
      const roomNumber = requiredText(input.roomNumber, 'หมายเลขห้อง', 20)
      if (!gradeLevels.has(gradeLevel)) throw new Error('ระดับชั้นไม่ถูกต้อง')
      if (!roomNumberPattern.test(roomNumber)) {
        throw new Error('หมายเลขห้องใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีดกลาง และขีดล่าง')
      }
      const { data, error } = await serviceClient.rpc('service_create_school_classroom', {
        p_actor_user_id: userData.user.id,
        p_term_id: idValue(input.termId, 'รหัสภาคเรียน'),
        p_grade_level: gradeLevel,
        p_room_number: roomNumber,
      })
      if (error) {
        if (error.code === '23505') throw new Error('ชั้นและห้องนี้มีอยู่ในภาคเรียนปัจจุบันแล้ว')
        throw new Error(error.message)
      }
      return response(200, { ok: true, data: data as JsonRecord })
    }

    if (action === 'create-person') {
      const kind = String(input.kind ?? '')
      if (!['student', 'staff'].includes(kind)) throw new Error('ประเภทบุคคลไม่ถูกต้อง')
      const username = usernameValue(input.username)
      const code = requiredText(input.code, kind === 'student' ? 'รหัสนักเรียน' : 'รหัสบุคลากร', 80)
      const givenName = requiredText(input.givenName, 'ชื่อ', 160)
      const familyName = requiredText(input.familyName, 'นามสกุล', 160)
      const title = optionalText(input.title, 80)
      const role = kind === 'student' ? null : String(input.role ?? 'teacher')
      if (kind === 'staff' && !['teacher', 'director', 'admin'].includes(role ?? '')) {
        throw new Error('ตำแหน่งบุคลากรไม่ถูกต้อง')
      }

      const email = `${username}@${authDomain}`
      const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { username, must_change_password: true },
      })
      if (authError || !authData.user) {
        if (authError?.message.toLowerCase().includes('already')) {
          throw new Error('ชื่อผู้ใช้นี้มีบัญชีอยู่แล้ว')
        }
        throw new Error(authError?.message ?? 'สร้างบัญชีเข้าสู่ระบบไม่สำเร็จ')
      }

      const { data, error } = await serviceClient.rpc('service_create_school_person', {
        p_actor_user_id: userData.user.id,
        p_auth_user_id: authData.user.id,
        p_kind: kind,
        p_username: username,
        p_code: code,
        p_title: title,
        p_given_name: givenName,
        p_family_name: familyName,
        p_role: role,
        p_classroom_id: optionalId(input.classroomId),
        p_birth_date: isoDate(input.birthDate),
      })
      if (error) {
        await serviceClient.auth.admin.deleteUser(authData.user.id)
        throw new Error(error.message)
      }

      let activation
      try {
        activation = await generateActivationCode(serviceClient, username)
      } catch {
        activation = undefined
      }
      return response(200, {
        ok: true,
        data: {
          ...(data as JsonRecord),
          ...(activation ?? {}),
        },
      })
    }

    if (action === 'update-student') {
      const status = String(input.status ?? '')
      if (!['active', 'suspended', 'graduated', 'archived'].includes(status)) {
        throw new Error('สถานะนักเรียนไม่ถูกต้อง')
      }
      const { error } = await serviceClient.rpc('service_update_school_student', {
        p_actor_user_id: userData.user.id,
        p_student_id: idValue(input.studentId, 'รหัสนักเรียน'),
        p_title: optionalText(input.title, 80),
        p_given_name: requiredText(input.givenName, 'ชื่อ', 160),
        p_family_name: requiredText(input.familyName, 'นามสกุล', 160),
        p_status: status,
        p_classroom_id: optionalId(input.classroomId),
        p_birth_date: isoDate(input.birthDate),
      })
      if (error) throw new Error(error.message)
      return response(200, { ok: true, data: null })
    }

    if (action === 'update-staff') {
      const status = String(input.status ?? '')
      const role = String(input.role ?? '')
      if (!['active', 'suspended', 'archived'].includes(status)) {
        throw new Error('สถานะบุคลากรไม่ถูกต้อง')
      }
      if (!['teacher', 'director', 'admin'].includes(role)) {
        throw new Error('ตำแหน่งบุคลากรไม่ถูกต้อง')
      }
      const classroomIds = Array.isArray(input.classroomIds)
        ? [...new Set(input.classroomIds.map((value) => idValue(value, 'รหัสห้องเรียน')))]
        : []
      const { error } = await serviceClient.rpc('service_update_school_staff', {
        p_actor_user_id: userData.user.id,
        p_teacher_id: idValue(input.teacherId, 'รหัสบุคลากร'),
        p_title: optionalText(input.title, 80),
        p_given_name: requiredText(input.givenName, 'ชื่อ', 160),
        p_family_name: requiredText(input.familyName, 'นามสกุล', 160),
        p_status: status,
        p_role: role,
        p_classroom_ids: classroomIds,
      })
      if (error) throw new Error(error.message)
      return response(200, { ok: true, data: null })
    }

    if (action === 'issue-activation') {
      const username = usernameValue(input.username)
      const { error } = await serviceClient.rpc('service_get_activation_account', {
        p_actor_user_id: userData.user.id,
        p_username: username,
      })
      if (error) throw new Error(error.message)
      const activation = await generateActivationCode(serviceClient, username)
      return response(200, { ok: true, data: activation })
    }

    return response(400, { ok: false, error: 'ไม่รู้จักคำสั่งที่ร้องขอ' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ไม่สามารถดำเนินการได้'
    return response(400, { ok: false, error: message })
  }
})
