-- Synthetic test accounts. No passwords or real student information.
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111','teacher-a@example.invalid'),
 ('22222222-2222-4222-8222-222222222222','student-a@example.invalid'),
 ('33333333-3333-4333-8333-333333333333','teacher-b@example.invalid'),
 ('44444444-4444-4444-8444-444444444444','student-b@example.invalid');
insert into public.lab_members(user_id,alias,role,class_id) values
 ('11111111-1111-4111-8111-111111111111','교사 A','teacher','qa-a'),
 ('22222222-2222-4222-8222-222222222222','학생 A','student','qa-a'),
 ('33333333-3333-4333-8333-333333333333','교사 B','teacher','qa-b'),
 ('44444444-4444-4444-8444-444444444444','학생 B','student','qa-b');
