grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.word_progress to authenticated;
grant select, insert, update, delete on public.daily_records to authenticated;
grant usage, select on sequence public.word_progress_id_seq to authenticated;
grant usage, select on sequence public.daily_records_id_seq to authenticated;
