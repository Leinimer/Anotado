import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware de Segurança com Supabase Auth.
 * Atualiza cookies de sessão e protege rotas autenticadas.
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname.startsWith('/login');

  // Verifica se as chaves do Supabase estão configuradas
  const hasValidSupabaseConfig =
    supabaseUrl.length > 0 &&
    supabaseAnonKey.length > 0 &&
    !supabaseUrl.includes('placeholder') &&
    supabaseUrl !== 'https://your-project.supabase.co';

  if (hasValidSupabaseConfig) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    });

    // Atualiza e valida a sessão real no servidor
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Se o usuário não está autenticado e tenta acessar área protegida -> redireciona para /login
    if (!user && !isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      const redirectResponse = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }

    // Se o usuário já está autenticado e tenta acessar a página /login -> redireciona para /
    if (user && isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      const redirectResponse = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
      });
      return redirectResponse;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Aplica o middleware em todas as rotas exceto arquivos estáticos,
     * imagens e rotas internas do Next.js
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
