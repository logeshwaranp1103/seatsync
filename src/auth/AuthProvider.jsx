import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase, isUUID } from '../lib/supabase';
import { authService } from '../services/authService';
import { useSync } from '../hooks/useSync';
import toast from 'react-hot-toast';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const { broadcast } = useSync((event) => {
    if (event?.type === 'storage_change' && event.key === 'seatsync_session') {
      setUser(authService.getCurrentUser());
    } else if (event?.type === 'logout') {
      setUser(null);
    }
  });

  // Rehydrate initial user & subscribe to Supabase Auth state
  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    setUser(currentUser);
    setLoading(false);

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user?.id && isUUID(session.user.id)) {
        const profile = await authService.ensureMyProfile();

        if (profile) {
          const status = String(profile.status || profile.account_status || 'active').toLowerCase();
          const base = import.meta.env.BASE_URL || '/';
          if (status === 'blocked' || status === 'suspended') {
            await authService.logout();
            setUser(null);
            window.location.href = `${base}${status === 'blocked' ? 'account-blocked' : 'account-suspended'}`;
            return;
          }
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Realtime subscription to profiles table for live ejection on admin block/suspend
  useEffect(() => {
    if (!user?.id || !isUUID(user.id)) return;

    const profileChannel = supabase
      .channel(`profile-eject-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
        async (payload) => {
          const updated = payload.new;
          const status = String(updated.status || updated.account_status || 'active').toLowerCase();

          if (status === 'blocked' || status === 'suspended') {
            const blockedInfo = {
              reason: updated.blocked_reason || 'Policy violation',
              blockedAt: updated.blocked_at || new Date().toISOString(),
              blockedBy: 'Library Administration'
            };
            try {
              sessionStorage.setItem('seatsync_blocked_info', JSON.stringify(blockedInfo));
              localStorage.setItem('seatsync_blocked_info', JSON.stringify(blockedInfo));
            } catch { /* fallback */ }

            toast.error(`ALERT: Your account access was ${status.toUpperCase()} by library staff.`);
            await authService.logout();
            setUser(null);
            const base = import.meta.env.BASE_URL || '/';
            window.location.href = `${base}${status === 'blocked' ? 'account-blocked' : 'account-suspended'}`;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [user?.id]);

  const login = async (identifier, password, rememberMe = true) => {
    try {
      const loggedInUser = await authService.login(identifier, password, rememberMe);
      setUser(loggedInUser);
      broadcast({ type: 'login', user: loggedInUser });
      return loggedInUser;
    } catch (err) {
      if (err.code === 'ACCOUNT_BLOCKED') {
        const base = import.meta.env.BASE_URL || '/';
        window.location.href = `${base}account-blocked`;
      } else if (err.code === 'ACCOUNT_SUSPENDED') {
        const base = import.meta.env.BASE_URL || '/';
        window.location.href = `${base}account-suspended`;
      }
      throw err;
    }
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
    broadcast({ type: 'logout' });
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};
