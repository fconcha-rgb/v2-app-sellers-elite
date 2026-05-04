import {
    useState,
    useEffect,
    useCallback,
    useRef,
    createContext,
    useContext,
    type ReactNode,
    } from 'react';
    import { supabase } from './api';
    import type { Session, User } from '@supabase/supabase-js';
    
    /* ──────────────────────────────────────────────────────────────
    CONFIG
    ────────────────────────────────────────────────────────────── */
    const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 min cierra sesion
    const INACTIVITY_WARNING_MS = 25 * 60 * 1000; // 25 min muestra aviso
    
    const C = {
    bg: '#F8F9FB',
    bgCard: '#FFFFFF',
    bgAlt: '#F1F3F6',
    border: '#E5E8EC',
    borderLight: '#EEF0F3',
    text: '#1B1F24',
    textSec: '#5A6473',
    textMuted: '#8E96A3',
    primary: '#16A34A',
    primaryLight: '#DCFCE7',
    primaryDark: '#15803D',
    primaryBg: '#F0FDF4',
    danger: '#EF4444',
    dangerLight: '#FEE2E2',
    warning: '#F59E0B',
    warningLight: '#FEF9C3',
    };
    
    const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
    
    const AUTH_CSS =
    "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');" +
    '@keyframes auth-fi{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
    '@keyframes auth-spin{to{transform:rotate(360deg)}}' +
    '*{box-sizing:border-box}' +
    '.auth-shell{background:linear-gradient(180deg,#F8F9FB 0%,#EEF6F1 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;font-family:' + FONT + '}' +
    '.auth-card{background:#fff;border-radius:18px;box-shadow:0 10px 40px rgba(15,23,42,.08),0 2px 6px rgba(15,23,42,.04);padding:32px;width:100%;max-width:420px;animation:auth-fi .3s ease-out}' +
    '.auth-input{width:100%;background:#fff;border:1.5px solid #E5E8EC;color:#1B1F24;padding:11px 14px;border-radius:10px;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s,box-shadow .15s}' +
    '.auth-input:focus{border-color:#16A34A;box-shadow:0 0 0 3px #DCFCE7}' +
    '.auth-input:disabled{background:#F8F9FB;color:#8E96A3;cursor:not-allowed}' +
    '.auth-btn{width:100%;padding:12px 16px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;border:none;transition:all .15s;font-family:inherit}' +
    '.auth-btn-primary{background:#16A34A;color:#fff;box-shadow:0 2px 8px rgba(22,163,74,.25)}' +
    '.auth-btn-primary:hover:not(:disabled){background:#15803D;box-shadow:0 4px 14px rgba(22,163,74,.35)}' +
    '.auth-btn-primary:disabled{background:#86EFAC;cursor:not-allowed;box-shadow:none}' +
    '.auth-btn-ghost{background:transparent;color:#5A6473;border:1.5px solid #E5E8EC}' +
    '.auth-btn-ghost:hover:not(:disabled){background:#F1F3F6}' +
    '.auth-link{background:none;border:none;color:#16A34A;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;padding:0;text-decoration:none}' +
    '.auth-link:hover{text-decoration:underline}' +
    '.auth-label{font-size:11px;color:#8E96A3;display:block;margin-bottom:6px;font-weight:700;letter-spacing:.4px;text-transform:uppercase}' +
    '@media(max-width:480px){.auth-card{padding:24px 20px;border-radius:14px}}';
    
    /* ──────────────────────────────────────────────────────────────
    CONTEXT
    ────────────────────────────────────────────────────────────── */
    type AuthContextValue = {
    session: Session | null;
    user: User | null;
    signOut: () => Promise<void>;
    };
    
    const AuthContext = createContext<AuthContextValue>({
    session: null,
    user: null,
    signOut: async () => {},
    });
    
    export const useAuth = () => useContext(AuthContext);
    
    /* ──────────────────────────────────────────────────────────────
    AUTH GATE (componente principal)
    ────────────────────────────────────────────────────────────── */
    type Stage = 'loading' | 'login' | 'recovery' | 'notAllowed' | 'authed';
    
    export function AuthGate(props: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [stage, setStage] = useState<Stage>('loading');
    const [allowedEmail, setAllowedEmail] = useState('');

    // Refs que siempre apuntan al valor actual (sin stale closure)
    const sessionRef = useRef<Session | null>(null);
    const stageRef = useRef<Stage>('loading');
    useEffect(() => { sessionRef.current = session; }, [session]);
    useEffect(() => { stageRef.current = stage; }, [stage]);
    
    const checkAllowed = useCallback(async (s: Session) => {
    const email = (s.user.email || '').toLowerCase().trim();
    setAllowedEmail(email);
    if (!email) {
    setStage('notAllowed');
    return;
    }
    const { data, error } = await supabase
    .from('allowed_emails')
    .select('email')
    .ilike('email', email)
    .maybeSingle();
    if (error) console.warn('allowed_emails check error:', error);
    setStage(data ? 'authed' : 'notAllowed');
    }, []);
    
    useEffect(() => {
    let mounted = true;
    
    
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setSession(data.session);
        checkAllowed(data.session);
      } else {
        setStage('login');
      }
    });
    
    const sub = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return;
    
      if (event === 'PASSWORD_RECOVERY') {
        setSession(newSession);
        setStage('recovery');
        return;
      }
      if (event === 'SIGNED_OUT' || !newSession) {
        setSession(null);
        setStage('login');
        return;
      }
      // Refresh silencioso de token o update de user: solo actualizar sesion,
      // NO re-validar allowed_emails ni cambiar stage (sino la app se "recarga")
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setSession(newSession);
        return;
      }

      // SIGNED_IN puede dispararse al volver a la pestana aunque ya estes logueado.
      // Usamos refs (no state) para evitar stale closure dentro del callback.
      if (event === 'SIGNED_IN') {
        const sameUser = sessionRef.current?.user?.id === newSession?.user?.id;
        if (sameUser && stageRef.current === 'authed') {
          // Mismo usuario, ya validado: solo refrescar token silenciosamente
          setSession(newSession);
          return;
        }
        setSession(newSession);
        setStage('loading');
        checkAllowed(newSession);
      }
    });
    
    return () => {
      mounted = false;
      sub.data.subscription.unsubscribe();
    };
    
    
    }, [checkAllowed]);
    
    const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setStage('login');
    }, []);
    
    if (stage === 'loading') {
    return (
    <>
    <style>{AUTH_CSS}</style>
    <LoadingScreen />
    </>
    );
    }
    
    if (stage === 'recovery') {
    return (
    <>
    <style>{AUTH_CSS}</style>
    <NewPasswordScreen
    onDone={() => {
    if (session) checkAllowed(session);
    else setStage('login');
    }}
    />
    </>
    );
    }
    
    if (stage === 'login') {
    return (
    <>
    <style>{AUTH_CSS}</style>
    <LoginScreen />
    </>
    );
    }
    
    if (stage === 'notAllowed') {
    return (
    <>
    <style>{AUTH_CSS}</style>
    <NotAllowedScreen email={allowedEmail} onSignOut={signOut} />
    </>
    );
    }
    
    // stage === 'authed'
    return (
    <AuthContext.Provider value={{ session, user: session?.user || null, signOut }}>
    <InactivityWatcher onTimeout={signOut}>{props.children}</InactivityWatcher>
    </AuthContext.Provider>
    );
    }
    
    /* ──────────────────────────────────────────────────────────────
    LOADING
    ────────────────────────────────────────────────────────────── */
    function LoadingScreen() {
    return (
    <div className="auth-shell">
    <div style={{ textAlign: 'center', color: C.primary }}>
    <div
    style={{
    width: 44,
    height: 44,
    border: '3px solid ' + C.primaryLight,
    borderTop: '3px solid ' + C.primary,
    borderRadius: '50%',
    animation: 'auth-spin 1s linear infinite',
    margin: '0 auto 14px',
    }}
    />
    <span style={{ fontSize: 14, fontWeight: 600 }}>Cargando…</span>
    </div>
    </div>
    );
    }
    
    /* ──────────────────────────────────────────────────────────────
    LOGIN SCREEN (con sub-vistas: login / forgot / request)
    ────────────────────────────────────────────────────────────── */
    type View = 'login' | 'forgot' | 'request';
    
    function LoginScreen() {
    const [view, setView] = useState<View>('login');
    
    return (
    <div className="auth-shell">
    <div className="auth-card">
    <Brand />
    {view === 'login' && (
    <LoginForm
    onForgot={() => setView('forgot')}
    onRequest={() => setView('request')}
    />
    )}
    {view === 'forgot' && <ForgotForm onBack={() => setView('login')} />}
    {view === 'request' && <RequestForm onBack={() => setView('login')} />}
    </div>
    </div>
    );
    }
    
    function Brand() {
    return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
    <h1
    style={{
    margin: 0,
    fontSize: 24,
    fontWeight: 800,
    color: C.primary,
    letterSpacing: '-0.5px',
    }}
    > 
    SELLERSELITE
    </h1>
    <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textMuted }}>
    Marketplace Falabella Chile
    </p>
    </div>
    );
    }
    
    /* ─── LOGIN FORM ─────────────────────────────────────────────── */
    function LoginForm(props: { onForgot: () => void; onRequest: () => void }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPwd, setShowPwd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [showRequestHint, setShowRequestHint] = useState(false);
    
    const submit = async () => {
    setErr('');
    setShowRequestHint(false);
    if (!email.trim() || !password) {
    setErr('Ingresa tu email y contraseña');
    return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
    });
    setLoading(false);
    
    
    if (error) {
      const msg = error.message || '';
      if (msg.toLowerCase().includes('invalid login') || msg.toLowerCase().includes('invalid credentials')) {
        setErr('Email o contraseña incorrectos.');
        setShowRequestHint(true);
      } else if (msg.toLowerCase().includes('email not confirmed')) {
        setErr('Tu correo aún no está confirmado. Revisa tu bandeja de entrada.');
      } else {
        setErr(msg);
      }
    }
    // Si todo OK, AuthGate detecta el cambio de sesion via onAuthStateChange
    
    
    };
    
    const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
    };
    
    return (
    <div>
    <h2 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 700, color: C.text, textAlign: 'center' }}>
    Iniciar sesión
    </h2>
    
    
      <div style={{ marginBottom: 14 }}>
        <label className="auth-label">Email</label>
        <input
          className="auth-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onKey}
          placeholder="tu@falabella.com"
          disabled={loading}
        />
      </div>
    
      <div style={{ marginBottom: 6 }}>
        <label className="auth-label">Contraseña</label>
        <div style={{ position: 'relative' }}>
          <input
            className="auth-input"
            type={showPwd ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKey}
            placeholder="••••••••"
            disabled={loading}
            style={{ paddingRight: 56 }}
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            disabled={loading}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: C.textMuted,
              fontSize: 11,
              fontWeight: 700,
              cursor: 'pointer',
              padding: '4px 8px',
              fontFamily: 'inherit',
            }}
          >
            {showPwd ? 'OCULTAR' : 'VER'}
          </button>
        </div>
      </div>
    
      <div style={{ textAlign: 'right', marginBottom: 14 }}>
        <button className="auth-link" onClick={props.onForgot} disabled={loading} style={{ fontSize: 12 }}>
          ¿Olvidaste tu contraseña?
        </button>
      </div>
    
      {err && (
        <div
          style={{
            background: C.dangerLight,
            color: C.danger,
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 12,
            border: '1px solid ' + C.danger + '40',
          }}
        >
          {err}
          {showRequestHint && (
            <div style={{ marginTop: 8 }}>
              <button
                className="auth-link"
                onClick={props.onRequest}
                style={{ color: C.danger, textDecoration: 'underline', fontSize: 12 }}
              >
                ¿No tienes cuenta? Solicítala aquí →
              </button>
            </div>
          )}
        </div>
      )}
    
      <button className="auth-btn auth-btn-primary" onClick={submit} disabled={loading}>
        {loading ? 'Ingresando…' : 'Iniciar Sesión'}
      </button>
    
      <div
        style={{
          marginTop: 20,
          paddingTop: 18,
          borderTop: '1px solid ' + C.borderLight,
          textAlign: 'center',
          fontSize: 13,
          color: C.textSec,
        }}
      >
        ¿No tienes cuenta?{' '}
        <button className="auth-link" onClick={props.onRequest} disabled={loading}>
          Solicitar acceso
        </button>
      </div>
    </div>
    
    
    );
    }
    
    /* ─── FORGOT PASSWORD ────────────────────────────────────────── */
    function ForgotForm(props: { onBack: () => void }) {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [sent, setSent] = useState(false);
    
    const submit = async () => {
    setErr('');
    if (!email.trim()) {
    setErr('Ingresa tu email');
    return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: window.location.origin,
    });
    setLoading(false);
    if (error) {
    setErr(error.message);
    return;
    }
    setSent(true);
    };
    
    if (sent) {
    return (
    <div>
    <BackLink onBack={props.onBack} />
    <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
    <div
    style={{
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: C.primaryLight,
    color: C.primary,
    fontSize: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    }}
    > 
    ✓
    </div>
    <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: C.text }}>
    Revisa tu correo
    </h2>
    <p style={{ margin: '0 0 18px', fontSize: 13, color: C.textSec, lineHeight: 1.5 }}>
    Si <b>{email}</b> está registrado, te enviamos un enlace para definir una nueva contraseña.
    </p>
    <button className="auth-btn auth-btn-ghost" onClick={props.onBack}>
    Volver al inicio
    </button>
    </div>
    </div>
    );
    }
    
    return (
    <div>
    <BackLink onBack={props.onBack} />
    <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: C.text, textAlign: 'center' }}>
    Recuperar contraseña
    </h2>
    <p
    style={{
    margin: '0 0 20px',
    fontSize: 13,
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 1.4,
    }}
    > 
    Ingresatu email y te enviaremos un enlace para restablecerla.
    </p>
    
    
      <div style={{ marginBottom: 14 }}>
        <label className="auth-label">Email</label>
        <input
          className="auth-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="tu@falabella.com"
          disabled={loading}
        />
      </div>
    
      {err && (
        <div
          style={{
            background: C.dangerLight,
            color: C.danger,
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 12,
            border: '1px solid ' + C.danger + '40',
          }}
        >
          {err}
        </div>
      )}
    
      <button className="auth-btn auth-btn-primary" onClick={submit} disabled={loading}>
        {loading ? 'Enviando…' : 'Enviar Enlace'}
      </button>
    </div>
    
    
    );
    }
    
    /* ─── REQUEST ACCOUNT ────────────────────────────────────────── */
    function RequestForm(props: { onBack: () => void }) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [sent, setSent] = useState(false);
    
    const submit = async () => {
    setErr('');
    if (!email.trim() || !name.trim()) {
    setErr('Email y nombre son obligatorios');
    return;
    }
    setLoading(true);
    const { error } = await supabase.from('account_requests').insert({
    email: email.trim().toLowerCase(),
    name: name.trim(),
    reason: reason.trim() || null,
    status: 'pending',
    });
    setLoading(false);
    if (error) {
    setErr(error.message);
    return;
    }
    setSent(true);
    };
    
    if (sent) {
    return (
    <div>
    <BackLink onBack={props.onBack} />
    <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
    <div
    style={{
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: C.primaryLight,
    color: C.primary,
    fontSize: 28,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    }}
    > 
    ✓
    </div>
    <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, color: C.text }}>
    Solicitud enviada
    </h2>
    <p style={{ margin: '0 0 18px', fontSize: 13, color: C.textSec, lineHeight: 1.5 }}>
    Tu solicitud para <b>{email}</b> fue recibida. El administrador la revisará y te notificará por correo.
    </p>
    <button className="auth-btn auth-btn-ghost" onClick={props.onBack}>
    Volver al inicio
    </button>
    </div>
    </div>
    );
    }
    
    return (
    <div>
    <BackLink onBack={props.onBack} />
    <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: C.text, textAlign: 'center' }}>
    Solicitar Acceso
    </h2>
    <p
    style={{
    margin: '0 0 20px',
    fontSize: 13,
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 1.4,
    }}
    > 
    Tusolicitud será revisada por el administrador.
    </p>
    
    
      <div style={{ marginBottom: 12 }}>
        <label className="auth-label">Nombre completo *</label>
        <input
          className="auth-input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Felipe Pérez"
          disabled={loading}
        />
      </div>
    
      <div style={{ marginBottom: 12 }}>
        <label className="auth-label">Email corporativo *</label>
        <input
          className="auth-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@falabella.com"
          disabled={loading}
        />
      </div>
    
      <div style={{ marginBottom: 14 }}>
        <label className="auth-label">Motivo / Rol (opcional)</label>
        <textarea
          className="auth-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej: KAM Electro, necesito acceso a Cobros…"
          disabled={loading}
          rows={3}
          style={{ resize: 'vertical', minHeight: 70, fontFamily: 'inherit' }}
        />
      </div>
    
      {err && (
        <div
          style={{
            background: C.dangerLight,
            color: C.danger,
            padding: '10px 12px',
            borderRadius: 10,
            fontSize: 13,
            marginBottom: 12,
            border: '1px solid ' + C.danger + '40',
          }}
        >
          {err}
        </div>
      )}
    
      <button className="auth-btn auth-btn-primary" onClick={submit} disabled={loading}>
        {loading ? 'Enviando…' : 'Enviar Solicitud'}
      </button>
    </div>
    
    
    );
    }
    
    function BackLink(props: { onBack: () => void }) {
    return (
    <button
    className="auth-link"
    onClick={props.onBack}
    style={{ marginBottom: 14, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
    > 
    ←Volver
    </button>
    );
    }
    
    /* ─── NEW PASSWORD (post recovery) ───────────────────────────── */
    function NewPasswordScreen(props: { onDone: () => void }) {
    const [pwd, setPwd] = useState('');
    const [pwd2, setPwd2] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    
    const submit = async () => {
    setErr('');
    if (pwd.length < 8) {
    setErr('La contraseña debe tener al menos 8 caracteres');
    return;
    }
    if (pwd !== pwd2) {
    setErr('Las contraseñas no coinciden');
    return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);
    if (error) {
    setErr(error.message);
    return;
    }
    props.onDone();
    };
    
    return (
    <div className="auth-shell">
    <div className="auth-card">
    <Brand />
    <h2 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: C.text, textAlign: 'center' }}>
    Define una nueva contraseña
    </h2>
    <p
    style={{
    margin: '0 0 20px',
    fontSize: 13,
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 1.4,
    }}
    > 
    Mínimo8 caracteres.
    </p>
    
    
        <div style={{ marginBottom: 12 }}>
          <label className="auth-label">Nueva contraseña</label>
          <input
            className="auth-input"
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="••••••••"
            disabled={loading}
            autoComplete="new-password"
          />
        </div>
    
        <div style={{ marginBottom: 14 }}>
          <label className="auth-label">Confirmar contraseña</label>
          <input
            className="auth-input"
            type="password"
            value={pwd2}
            onChange={(e) => setPwd2(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="••••••••"
            disabled={loading}
            autoComplete="new-password"
          />
        </div>
    
        {err && (
          <div
            style={{
              background: C.dangerLight,
              color: C.danger,
              padding: '10px 12px',
              borderRadius: 10,
              fontSize: 13,
              marginBottom: 12,
              border: '1px solid ' + C.danger + '40',
            }}
          >
            {err}
          </div>
        )}
    
        <button className="auth-btn auth-btn-primary" onClick={submit} disabled={loading}>
          {loading ? 'Guardando…' : 'Guardar Contraseña'}
        </button>
      </div>
    </div>
    
    
    );
    }
    
    /* ─── NOT ALLOWED ────────────────────────────────────────────── */
    function NotAllowedScreen(props: { email: string; onSignOut: () => void }) {
    return (
    <div className="auth-shell">
    <div className="auth-card" style={{ textAlign: 'center' }}>
    <div
    style={{
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: C.warningLight,
    color: C.warning,
    fontSize: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    }}
    > 
    ⚠
    </div>
    <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, color: C.text }}>
    Acceso no autorizado
    </h2>
    <p style={{ margin: '0 0 6px', fontSize: 13, color: C.textSec, lineHeight: 1.5 }}>
    Tu cuenta <b>{props.email}</b> no está habilitada para usar esta aplicación.
    </p>
    <p style={{ margin: '0 0 22px', fontSize: 13, color: C.textSec, lineHeight: 1.5 }}>
    Contacta al administrador para solicitar acceso.
    </p>
    <button className="auth-btn auth-btn-ghost" onClick={props.onSignOut}>
    Cerrar Sesión
    </button>
    </div>
    </div>
    );
    }
    
    /* ──────────────────────────────────────────────────────────────
    INACTIVITY WATCHER
    
    - Avisa al usuario a los 25 min de inactividad
    - Cierra sesion automaticamente a los 30 min
      ────────────────────────────────────────────────────────────── */
      function InactivityWatcher(props: { onTimeout: () => void; children: ReactNode }) {
      const [warning, setWarning] = useState(false);
      const [secondsLeft, setSecondsLeft] = useState(0);
    
    const warnTimerRef = useRef<number | null>(null);
    const logoutTimerRef = useRef<number | null>(null);
    const countdownRef = useRef<number | null>(null);
    const warningRef = useRef(false);
    
    const clearAll = () => {
    if (warnTimerRef.current) window.clearTimeout(warnTimerRef.current);
    if (logoutTimerRef.current) window.clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    warnTimerRef.current = null;
    logoutTimerRef.current = null;
    countdownRef.current = null;
    };
    
    const reset = useCallback(() => {
    clearAll();
    setWarning(false);
    warningRef.current = false;
    
    
    warnTimerRef.current = window.setTimeout(() => {
      setWarning(true);
      warningRef.current = true;
      const remainingSec = Math.floor((INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS) / 1000);
      setSecondsLeft(remainingSec);
      countdownRef.current = window.setInterval(() => {
        setSecondsLeft((s) => Math.max(0, s - 1));
      }, 1000);
    }, INACTIVITY_WARNING_MS);
    
    logoutTimerRef.current = window.setTimeout(() => {
      props.onTimeout();
    }, INACTIVITY_TIMEOUT_MS);
    
    
    }, [props]);
    
    useEffect(() => {
    reset();
    
    
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const handler = () => {
      // Si hay aviso visible, no resetear con cualquier interaccion:
      // el usuario debe usar el boton "Continuar"
      if (warningRef.current) return;
      reset();
    };
    
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    
    return () => {
      events.forEach((e) => window.removeEventListener(e, handler));
      clearAll();
    };
    
    
    }, [reset]);
    
    const continueSession = () => reset();
    
    return (
    <>
    {props.children}
    {warning && (
    <div
    style={{
    position: 'fixed',
    inset: 0,
    background: 'rgba(15,23,42,.5)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    fontFamily: FONT,
    }}
    > 
    <div
    style={{
    background: '#fff',
    borderRadius: 16,
    padding: 26,
    maxWidth: 380,
    width: '100%',
    boxShadow: '0 20px 50px rgba(0,0,0,.25)',
    animation: 'auth-fi .2s ease-out',
    }}
    > 
    <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 8 }}>⏱</div>
    <h3
    style={{
    margin: '0 0 8px',
    fontSize: 17,
    fontWeight: 700,
    color: C.text,
    textAlign: 'center',
    }}
    > 
    Tusesión expira pronto
    </h3>
    <p
    style={{
    margin: '0 0 18px',
    fontSize: 13,
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 1.5,
    }}
    > 
    Porinactividad, cerraremos tu sesión en{' '}
    <b style={{ color: C.warning }}>
    {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
    </b>
    </p>
    <div style={{ display: 'flex', gap: 8 }}>
    <button
    className="auth-btn auth-btn-ghost"
    onClick={props.onTimeout}
    style={{ flex: 1 }}
    > 
    CerrarSesión
    </button>
    <button
    className="auth-btn auth-btn-primary"
    onClick={continueSession}
    style={{ flex: 1 }}
    > 
    Continuar
    </button>
    </div>
    </div>
    </div>
    )}
    </>
    );
    }
