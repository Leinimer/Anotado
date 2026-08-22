import { createBrowserClient, createServerClient } from '@supabase/ssr';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(
    url &&
    key &&
    !url.includes('placeholder') &&
    url !== 'https://your-project.supabase.co'
  );
}

/**
 * Opções de cookies compatíveis com o ambiente de iframe do AI Studio e deploy HTTPS.
 * SameSite=None e Secure=true garantem a propagação de cookies tanto no iframe (Preview)
 * quanto em navegação de topo (Deploy).
 */
export const supabaseCookieOptions = {
  path: '/',
  sameSite: 'none' as const,
  secure: true,
};

/**
 * Cria o cliente Supabase para o lado do cliente (Navegador).
 * Utiliza @supabase/ssr com sincronização de cookies SameSite=None e Secure para compatibilidade total.
 */
export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions,
  });
}

/**
 * Cria o cliente Supabase para Server Components e Server Actions.
 */
export function createServerSupabaseClient(cookieStore: ReadonlyRequestCookies | any) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, {
              ...options,
              ...supabaseCookieOptions,
            });
          });
        } catch {
          // Em Server Components os cookies são somente leitura
        }
      },
    },
  });
}

