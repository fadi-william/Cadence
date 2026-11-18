import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./pages/home.page').then((m) => m.HomePage),
    title: 'Cadence: see how your engineering teams deliver',
  },
  { path: 'docs', pathMatch: 'full', redirectTo: 'docs/getting-started' },
  {
    path: 'docs/:slug',
    loadComponent: () => import('./pages/docs.page').then((m) => m.DocsPage),
  },
  { path: '**', redirectTo: '' },
];
