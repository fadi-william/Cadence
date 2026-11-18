import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard, setupGuard, setupPageGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'setup',
    canActivate: [setupPageGuard],
    loadComponent: () => import('./features/setup/setup.page').then((m) => m.SetupPage),
    title: 'Welcome · Cadence',
  },
  {
    path: 'login',
    canActivate: [setupGuard, guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
    title: 'Sign in · Cadence',
  },
  {
    path: 'forgot-password',
    canActivate: [setupGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
    title: 'Forgot password · Cadence',
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
    title: 'Reset password · Cadence',
  },
  {
    path: '',
    canActivate: [setupGuard, authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
        title: 'Dashboard · Cadence',
      },
      {
        path: 'delivery',
        loadComponent: () =>
          import('./features/delivery/delivery.page').then((m) => m.DeliveryPage),
        title: 'Delivery performance · Cadence',
      },
      {
        path: 'organization',
        loadComponent: () => import('./features/org/org.page').then((m) => m.OrgPage),
        title: 'Organization · Cadence',
      },
      {
        path: 'members',
        loadComponent: () => import('./features/members/members.page').then((m) => m.MembersPage),
        title: 'Members · Cadence',
      },
      {
        path: 'members/:id',
        loadComponent: () =>
          import('./features/members/member-detail.page').then((m) => m.MemberDetailPage),
        title: 'Member · Cadence',
      },
      {
        path: 'integrations',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () =>
          import('./features/integrations/integrations.page').then((m) => m.IntegrationsPage),
        title: 'Integrations · Cadence',
      },
      {
        path: 'audit',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./features/audit/audit.page').then((m) => m.AuditPage),
        title: 'Audit log · Cadence',
      },
      {
        path: 'account',
        loadComponent: () => import('./features/account/account.page').then((m) => m.AccountPage),
        title: 'Account · Cadence',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
