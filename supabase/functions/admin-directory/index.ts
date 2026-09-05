import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2'
import {
  isActiveDirectoryAdmin,
  tokenHasPasswordAuthentication,
} from '../_shared/directoryAuthorization.ts'
import {
  createTemporaryRecoveryPassword,
  passwordResetReason,
} from '../_shared/passwordReset.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}

const usernamePattern = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/
const gradeLevels = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'M1', 'M2', 'M3'])
const roomNumberPattern = /^[0-9A-Za-zก-๙._-]+$/
const defaultAuthEmailDomain = 'accounts.school-point.invalid'

type JsonRecord = Record<string, unknown>
type UntypedSupabaseClient = SupabaseClient<any, 'public', 'public', any, any>

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

function authEmailDomain(): string {
  // Keep the former generated-address domain as the safe compatibility default.
  // Both directory and import provisioning read this same Edge secret name.
  const domain = (Deno.env.get('SCHOOL_POINT_AUTH_EMAIL_DOMAIN') ?? defaultAuthEmailDomain)
    .trim()
    .toLowerCase()
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('การตั้งค่า SCHOOL_POINT_AUTH_EMAIL_DOMAIN ไม่ถูกต้อง')
  }
  return domain
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

const ACTIVATION_CODE_TTL_MS = 24 * 60 * 60 * 1000
const PASSWORD_RESET_CODE_TTL_MS = 60 * 60 * 1000
const ACCOUNT_CODE_DIGITS = 8
const ACCOUNT_CODE_LIMIT = 10 ** ACCOUNT_CODE_DIGITS

function createAccountCode(): string {
  const maximum = Math.floor(0x1_0000_0000 / ACCOUNT_CODE_LIMIT) * ACCOUNT_CODE_LIMIT
  const values = new Uint32Array(1)
  do crypto.getRandomValues(values)
  while (values[0] >= maximum)
  return String(values[0] % ACCOUNT_CODE_LIMIT).padStart(ACCOUNT_CODE_DIGITS, '0')
}

async function accountCodeDigest(secret: string, username: string, code: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${username}:${code}`))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createTemporaryActivationPassword(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const random = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `Sp1!${random}`
}

async function generateActivationCode(
  serviceClient: UntypedSupabaseClient,
  secretKey: string,
  actorUserId: string | null,
  userId: string,
  username: string,
  purpose: 'activation' | 'password-reset' = 'activation',
) {
  const activationCode = createAccountCode()
  const tokenHash = await accountCodeDigest(secretKey, username, activationCode)
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + (purpose === 'password-reset' ? PASSWORD_RESET_CODE_TTL_MS : ACTIVATION_CODE_TTL_MS))
  const { error } = await serviceClient.rpc('service_issue_school_account_code', {
    p_actor_user_id: actorUserId,
    p_user_id: userId,
    p_token_hash_hex: tokenHash,
    p_purpose: purpose,
    p_expires_at: expiresAt.toISOString(),
  })
  if (error) {
    throw new Error('สร้างรหัสเปิดใช้ครั้งเดียวไม่สำเร็จ กรุณาลองออกใหม่จากหน้าบัญชี')
  }
  return {
    username,
    activationCode,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    purpose,
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
    const authDomain = authEmailDomain()
    const parsedBody = await request.json().catch(() => null)
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return response(400, { ok: false, error: 'คำขอไม่ถูกต้อง' })
    }
    const body = parsedBody as JsonRecord
    const action = String(body.action ?? '')
    const input = body.input && typeof body.input === 'object' ? body.input as JsonRecord : {}
    const serviceClient = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    if (action === 'verify-account-code') {
      const username = usernameValue(input.username)
      const activationCode = String(input.activationCode ?? '').trim()
      if (!/^\d{8}$/.test(activationCode)) {
        return response(400, { ok: false, error: 'รหัสใช้ครั้งเดียวไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว' })
      }
      const tokenHash = await accountCodeDigest(secretKey, username, activationCode)
      const { data: consumed, error: consumeError } = await serviceClient.rpc('service_consume_school_account_code', {
        p_username: username,
        p_token_hash_hex: tokenHash,
      })
      const consumedRow = consumed && typeof consumed === 'object' ? consumed as JsonRecord : null
      if (consumeError || consumedRow?.ok !== true) {
        return response(400, { ok: false, error: 'รหัสใช้ครั้งเดียวไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว' })
      }
      const userId = String(consumedRow.userId ?? '')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        return response(400, { ok: false, error: 'ไม่สามารถเปิดใช้บัญชีได้ กรุณาให้ออกรหัสใหม่' })
      }
      const temporaryPassword = createTemporaryActivationPassword()
      const { error: updateError } = await serviceClient.auth.admin.updateUserById(userId, {
        password: temporaryPassword,
        user_metadata: { username, must_change_password: true },
      })
      if (updateError) {
        console.error('account-code password handoff failed', { userId, purpose: consumedRow.purpose })
        return response(400, { ok: false, error: 'ไม่สามารถเปิดใช้บัญชีได้ กรุณาให้ออกรหัสใหม่' })
      }
      const signInClient = createClient(supabaseUrl, publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: signInData, error: signInError } = await signInClient.auth.signInWithPassword({
        email: `${username}@${authDomain}`,
        password: temporaryPassword,
      })
      if (signInError || !signInData.session) {
        console.error('account-code session handoff failed', { userId, purpose: consumedRow.purpose })
        return response(400, { ok: false, error: 'ไม่สามารถเปิดใช้บัญชีได้ กรุณาให้ออกรหัสใหม่' })
      }
      return response(200, {
        ok: true,
        data: {
          accessToken: signInData.session.access_token,
          refreshToken: signInData.session.refresh_token,
          purpose: consumedRow.purpose,
        },
      })
    }

    const authorization = request.headers.get('Authorization') ?? ''
    const accessToken = authorization.replace(/^Bearer\s+/i, '').trim()
    if (!accessToken) return response(401, { ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' })

    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken)
    if (userError || !userData.user) {
      return response(401, { ok: false, error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' })
    }

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
    if (!tokenHasPasswordAuthentication(accessToken)) {
      return response(403, {
        ok: false,
        error: 'กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้งก่อนแก้ไขข้อมูลโรงเรียน',
      })
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
      const classroomIds = Array.isArray(input.classroomIds)
        ? [...new Set(input.classroomIds.map((value) => idValue(value, 'รหัสห้องเรียน')))]
        : []
      if (kind !== 'staff' && classroomIds.length) {
        throw new Error('กำหนดห้องเรียนได้เฉพาะบุคลากรตำแหน่งครู')
      }
      if (kind === 'staff' && role !== 'teacher' && classroomIds.length) {
        throw new Error('กำหนดห้องเรียนได้เฉพาะบุคลากรตำแหน่งครู')
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

      const { data, error } = await serviceClient.rpc('service_create_school_person_v2', {
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
        p_classroom_ids: classroomIds,
      })
      if (error) {
        await serviceClient.auth.admin.deleteUser(authData.user.id)
        throw new Error(error.message)
      }

      let activation
      try {
        activation = await generateActivationCode(serviceClient, secretKey, userData.user.id, authData.user.id, username)
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
      const { data: account, error } = await serviceClient.rpc('service_get_activation_account', {
        p_actor_user_id: userData.user.id,
        p_username: username,
      })
      if (error) throw new Error(error.message)
      const accountRow = account && typeof account === 'object' ? account as JsonRecord : null
      const userId = String(accountRow?.userId ?? '')
      const pendingPurpose = accountRow?.pendingPurpose === 'password-reset' ? 'password-reset' : 'activation'
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        throw new Error('ข้อมูลบัญชีสำหรับเปิดใช้ไม่ถูกต้อง')
      }
      const activation = await generateActivationCode(
        serviceClient,
        secretKey,
        userData.user.id,
        userId,
        username,
        pendingPurpose,
      )
      return response(200, { ok: true, data: activation })
    }

    if (action === 'reset-password') {
      const username = usernameValue(input.username)
      const reason = passwordResetReason(input.reason)
      const { data: account, error: prepareError } = await serviceClient.rpc(
        'service_prepare_school_account_password_reset',
        {
          p_actor_user_id: userData.user.id,
          p_username: username,
          p_reason: reason,
        },
      )
      if (prepareError) throw new Error(prepareError.message)
      if (!account || typeof account !== 'object') {
        throw new Error('ไม่พบข้อมูลบัญชีสำหรับกู้รหัสผ่าน')
      }
      const userId = String((account as JsonRecord).userId ?? '')
      const accountUsername = usernameValue((account as JsonRecord).username)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        throw new Error('ข้อมูลบัญชีสำหรับกู้รหัสผ่านไม่ถูกต้อง')
      }

      const { error: passwordError } = await serviceClient.auth.admin.updateUserById(userId, {
        password: createTemporaryRecoveryPassword(),
        user_metadata: { username: accountUsername, must_change_password: true },
      })
      if (passwordError) {
        throw new Error('บัญชีถูกกั้นไว้เพื่อความปลอดภัยแล้ว แต่ยังยกเลิกรหัสผ่านเดิมไม่สำเร็จ กรุณาออกรหัสครั้งเดียวใหม่')
      }

      let activation
      try {
        activation = await generateActivationCode(serviceClient, secretKey, userData.user.id, userId, accountUsername, 'password-reset')
      } catch {
        throw new Error('รหัสผ่านเดิมถูกยกเลิกแล้ว แต่ยังสร้างรหัสกู้บัญชีไม่สำเร็จ กรุณาออกรหัสครั้งเดียวใหม่')
      }
      return response(200, {
        ok: true,
        data: activation,
      })
    }

    return response(400, { ok: false, error: 'ไม่รู้จักคำสั่งที่ร้องขอ' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ไม่สามารถดำเนินการได้'
    return response(400, { ok: false, error: message })
  }
})
