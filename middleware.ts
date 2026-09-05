import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const supabaseCookieOptions = {
  path: '/',
  sameSite: 'none' as const,
  secure: true,
};

/**
 * Middleware de Segurança com Supabase Auth.
 * Atualiza cookies de sessão e protege rotas autenticadas.
 * Configurado com SameSite=None e Secure para suportar tanto o iframe do Preview quanto o Deploy.
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
      cookieOptions: supabaseCookieOptions,
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
            supabaseResponse.cookies.set(name, value, {
              ...options,
              ...supabaseCookieOptions,
            })
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
        redirectResponse.cookies.set(cookie.name, cookie.value, {
          ...cookie,
          ...supabaseCookieOptions,
        });
      });
      return redirectResponse;
    }

    // Se o usuário já está autenticado e tenta acessar a página /login -> redireciona para /
    if (user && isLoginPage) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      const redirectResponse = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        redirectResponse.cookies.set(cookie.name, cookie.value, {
          ...cookie,
          ...supabaseCookieOptions,
        });
      });
      return redirectResponse;
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Aplica o middleware em rotas da aplicação, exceto arquivos estáticos,
     * manifestos, imagens e rotas de suporte da infraestrutura
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html|js|css)$).*)',
  ],
};
