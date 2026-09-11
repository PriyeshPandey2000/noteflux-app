import { supabase } from './supabase-client';
import type { User, Session } from '@supabase/supabase-js';

export type AuthUser = {
  id: string;
  email: string;
  name?: string;
  isAnonymous: boolean;
};

export type AuthState = {
  user: AuthUser | null;
  session: Session | null;
  loading: boolean;
};

class AuthService {
  private authState: AuthState = {
    user: null,
    session: null,
    loading: true,
  };

  private listeners: Array<(state: AuthState) => void> = [];

  constructor() {
    this.initializeAuth();
    this.initializeDeepLinks();
  }

  private async initializeAuth() {
    try {
      // Get initial session
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Error getting session:', error);
      }

      this.updateAuthState({ 
        session, 
        user: session?.user ? this.mapUser(session.user) : null,
        loading: false 
      });

      // Listen for auth changes
      supabase.auth.onAuthStateChange((_, session) => {
        this.updateAuthState({
          session,
          user: session?.user ? this.mapUser(session.user) : null,
          loading: false,
        });
      });
    } catch (error) {
      console.error('Error initializing auth:', error);
      this.updateAuthState({ user: null, session: null, loading: false });
    }
  }

  // Initialize deep link handling
  private async initializeDeepLinks() {
    if ((window as any).__TAURI_INTERNALS__) {
      try {
        const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
        
        await onOpenUrl((urls) => {
          for (const url of urls) {
            if (url.startsWith('noteflux://auth/callback')) {
              this.handleAuthCallback(url);
              break;
            }
            if (url.startsWith('noteflux://checkout-success')) {
              // Decoupled via a DOM event (rather than importing the
              // subscription store here) to avoid a circular import —
              // subscription.svelte.ts already imports authService.
              window.dispatchEvent(new CustomEvent('noteflux-checkout-success'));
              break;
            }
          }
        });
      } catch (error) {
        console.error('Failed to initialize deep links:', error);
      }
    }
  }

  private mapUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email || '',
      name: user.user_metadata?.name || user.email,
      isAnonymous: user.is_anonymous || false,
    };
  }

  private updateAuthState(updates: Partial<AuthState>) {
    this.authState = { ...this.authState, ...updates };
    this.notifyListeners();
  }

  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.authState));
  }

  // Subscribe to auth state changes
  onAuthStateChange(callback: (state: AuthState) => void) {
    this.listeners.push(callback);
    
    // Immediately call with current state
    callback(this.authState);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // Get current auth state
  getAuthState(): AuthState {
    return { ...this.authState };
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!this.authState.session;
  }

  // Check if current user is anonymous
  isAnonymous(): boolean {
    return this.authState.user?.isAnonymous || false;
  }

  // Sign in anonymously
  async signInAnonymously() {
    try {
      const { data, error } = await supabase.auth.signInAnonymously();

      if (error) {
        console.error('Error signing in anonymously:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error during anonymous sign in:', error);
      throw new Error('Failed to sign in anonymously');
    }
  }

  // Sign in by opening browser to web app
  async signIn() {
    try {
      // Add redirect parameter for desktop app
      const redirectTo = 'noteflux://auth/callback';

      // Get current session to check if anonymous
      const { data: { session } } = await supabase.auth.getSession();

      // Build signin URL with anonymous session tokens if present
      let signInUrl = `https://noteflux.app/sign-in?redirect_to=${encodeURIComponent(redirectTo)}`;

      // If user is anonymous, pass tokens so website can link the data
      if (session?.user?.is_anonymous && session.access_token && session.refresh_token) {
        signInUrl += `&anon_token=${encodeURIComponent(session.access_token)}`;
        signInUrl += `&anon_refresh=${encodeURIComponent(session.refresh_token)}`;
      }

      // Check if we're in Tauri environment
      if ((window as any).__TAURI_INTERNALS__) {
        // Disable always-on-top so browser is visible
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().setAlwaysOnTop(false);
        } catch (e) {
          console.log('Could not disable always on top:', e);
        }

        // Use Tauri opener
        try {
          const openerModule = await import('@tauri-apps/plugin-opener');

          if (openerModule.openUrl) {
            await openerModule.openUrl(signInUrl);
          } else {
            throw new Error('openUrl function not available');
          }
        } catch (importError) {
          throw importError;
        }
      } else {
        // Use web browser API
        window.open(signInUrl, '_blank');
      }
    } catch (error) {
      throw new Error('Failed to open sign in page: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Sign up by opening browser to web app
  async signUp() {
    try {
      // Add redirect parameter for desktop app
      const redirectTo = 'noteflux://auth/callback';

      // Get current session to check if anonymous
      const { data: { session } } = await supabase.auth.getSession();

      // Build signup URL with anonymous session tokens if present
      let signUpUrl = `https://noteflux.app/sign-up?redirect_to=${encodeURIComponent(redirectTo)}`;

      // If user is anonymous, pass tokens so website can convert instead of creating new user
      if (session?.user?.is_anonymous && session.access_token && session.refresh_token) {
        signUpUrl += `&anon_token=${encodeURIComponent(session.access_token)}`;
        signUpUrl += `&anon_refresh=${encodeURIComponent(session.refresh_token)}`;
      }

      // Check if we're in Tauri environment
      if ((window as any).__TAURI_INTERNALS__) {
        // Disable always-on-top so browser is visible
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().setAlwaysOnTop(false);
        } catch (e) {
          console.log('Could not disable always on top:', e);
        }

        // Use Tauri opener
        try {
          const openerModule = await import('@tauri-apps/plugin-opener');

          if (openerModule.openUrl) {
            await openerModule.openUrl(signUpUrl);
          } else {
            throw new Error('openUrl function not available');
          }
        } catch (importError) {
          throw importError;
        }
      } else {
        // Use web browser API
        window.open(signUpUrl, '_blank');
      }
    } catch (error) {
      throw new Error('Failed to open sign up page: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Sign out
  async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Error signing out:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error during sign out:', error);
      throw new Error('Failed to sign out');
    }
  }

  // Handle auth callback from web app
  async handleAuthCallback(url: string) {
    try {
      // Extract tokens from URL
      const urlObj = new URL(url);
      const accessToken = urlObj.searchParams.get('access_token');
      const refreshToken = urlObj.searchParams.get('refresh_token');
      
      if (!accessToken || !refreshToken) {
        throw new Error('Missing auth tokens in callback URL');
      }

      // Set the session with the tokens
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        throw error;
      }

      return data;
    } catch (error) {
      throw new Error('Failed to complete authentication: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
}

// Export singleton instance
export const authService = new AuthService();