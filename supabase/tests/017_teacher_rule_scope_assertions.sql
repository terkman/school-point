begin;

select plan(11);

select ok(to_regclass('public.teacher_rule_proposals') is not null, 'teacher proposal table exists');
select ok(to_regprocedure('public.teacher_propose_rule(text,text,smallint,text,boolean)') is not null, 'teacher proposal RPC exists');
select ok(to_regprocedure('public.admin_review_teacher_rule(bigint,boolean,text)') is not null, 'admin review RPC exists');
select ok(to_regprocedure('public.admin_set_score_all_classrooms_grant(uuid,bigint,text)') is not null, 'schoolwide score grant RPC exists');
select ok(to_regprocedure('public.admin_revoke_score_all_classrooms_grant(bigint,text)') is not null, 'schoolwide score revoke RPC exists');
select ok(to_regprocedure('public.admin_update_behavior_rule(bigint,text,smallint,text)') is not null, 'deduction version RPC exists');
select ok(to_regprocedure('public.admin_update_positive_rule(bigint,text,smallint,boolean,text)') is not null, 'positive version RPC exists');

select ok(
  position('score_all_classrooms' in lower(pg_get_functiondef('private.teacher_has_student(bigint,bigint)'::regprocedure))) > 0,
  'student scope helper includes the explicit cross-class permission'
);
select ok(
  position('teacher_classroom_assignments' in lower(pg_get_functiondef('private.teacher_has_student(bigint,bigint)'::regprocedure))) > 0,
  'student scope helper preserves the normal assigned-classroom path'
);
select ok(
  position('has_password_session' in lower(pg_get_functiondef('private.teacher_has_student(bigint,bigint)'::regprocedure))) > 0,
  'student scope helper still requires a password-authenticated session'
);
select ok(
  not has_table_privilege('authenticated', 'public.teacher_rule_proposals', 'INSERT'),
  'teachers cannot bypass the audited proposal RPC with direct inserts'
);

select * from finish();
rollback;
