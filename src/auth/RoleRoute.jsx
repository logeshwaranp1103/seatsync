import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase, isUUID } from '../lib/supabase';

export default function RoleRoute({ allowedRoles, children }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user && allowedRoles && !allowedRoles.includes(user.role)) {
      // Record unauthorized access attempt in audit logs
      if (user.id && isUUID(user.id)) {
        supabase.from('audit_logs').insert({
          actor_id: user.id,
          event_type: 'UNAUTHORIZED_LIBRARIAN_ACCESS',
          metadata: {
            user_role: user.role,
            allowed_roles: allowedRoles,
            pathname: window.location.pathname
          }
        }).catch(() => {});
      }
    }
  }, [user, allowedRoles]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brandBlue border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-semibold text-slate-500">Verifying Permissions...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
}
