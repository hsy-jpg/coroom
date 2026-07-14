// 인증(로그인/회원가입/로그아웃) 관련 로직
import { supabase } from './supabaseClient.js';

/**
 * 회원가입
 * @param {string} email
 * @param {string} password
 * @param {string} name
 * @param {string} department
 */
export async function signUp(email, password, name, department) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        department,
      },
    },
  });
  return { data, error };
}

/**
 * 로그인
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

/**
 * 로그아웃
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/**
 * 현재 로그인한 사용자의 coroom_profiles row 조회
 * @param {string} userId
 */
export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('coroom_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

/**
 * 현재 세션 조회
 */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  return { data, error };
}
