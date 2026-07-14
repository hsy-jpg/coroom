// Supabase 클라이언트 초기화
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://mtdjditsurrhlxistnqk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_YLkvebFero_LJZ-9JzNkCw_aZC39Tqq';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
