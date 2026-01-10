import { redirect } from 'next/navigation';
import { getImpersonationInfo } from '@/lib/auth/session';
import Link from 'next/link';
import { AdminUserSelector } from '@/components/AdminUserSelector';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const impersonationInfo = await getImpersonationInfo();

  if (!impersonationInfo || !impersonationInfo.actualUser) {
    redirect('/auth/user/login');
  }

  const { actualUser, impersonatedUser, isImpersonating } = impersonationInfo;

  // Display user is the impersonated user if impersonating, otherwise actual user
  const displayUser = impersonatedUser || actualUser;

  return (
    <div className="min-h-screen bg-cream">
      {/* Impersonation Banner */}
      {isImpersonating && impersonatedUser && (
        <ImpersonationBanner impersonatedEmail={impersonatedUser.email} />
      )}

      {/* Header */}
      <header className="glass-nav sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-8">
              <Link href="/dashboard" className="font-display text-xl tracking-tight text-charcoal">
                Riva
              </Link>
              <nav className="flex space-x-1">
                <Link href="/dashboard" className="nav-link">
                  Requests
                </Link>
                <Link href="/dashboard/settings" className="nav-link">
                  Settings
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              {/* Admin User Selector - only shown to admins */}
              {actualUser.isAdmin && <AdminUserSelector />}

              <span className="text-sm text-slate">{displayUser.name || displayUser.email}</span>
              <a
                href="/api/auth/logout"
                className="text-sm text-slate hover:text-charcoal transition-colors duration-200"
              >
                Logout
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
