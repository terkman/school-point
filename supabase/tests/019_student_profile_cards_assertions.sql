begin;

select plan(5);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'students' and column_name = 'nickname'
  ),
  'students have an optional nickname'
);
select ok(to_regprocedure('public.update_my_student_nickname(text)') is not null, 'student nickname update RPC exists');
select ok(to_regprocedure('public.get_staff_student_profile_cards(bigint[])') is not null, 'staff profile-card RPC exists');
select ok(
  not exists (select 1 from storage.buckets where id = 'student-profile-images' and public),
  'student profile images remain in a private bucket'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'student_profile_images_select_staff'
  )
  and position('teacher_has_student' in pg_get_functiondef('public.get_staff_student_profile_cards(bigint[])'::regprocedure)) > 0,
  'staff avatar reads exist and retain teacher-to-student scope enforcement'
);

select * from finish();
rollback;
