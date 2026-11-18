import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
} from '@angular/core';
import { DomSanitizer, Title } from '@angular/platform-browser';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { GUIDE_SECTIONS, GUIDES } from '../docs/guides';
import { renderMarkdown } from '../docs/markdown';
import { REPO_BLOB } from '../site';
import { Icon } from '../ui/icon';

@Component({
  selector: 'docs-page',
  imports: [RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './docs.page.html',
})
export class DocsPage {
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly title = inject(Title);
  readonly slug = input.required<string>();

  protected readonly guides = GUIDES;
  protected readonly sections = GUIDE_SECTIONS;
  protected bySection = (s: string) => GUIDES.filter((g) => g.section === s);

  /** The Markdown is fetched relative to <base href>, so it works on GitHub Pages sub-paths. */
  protected readonly doc = resource({
    params: () => this.slug(),
    loader: async ({ params, abortSignal }) => {
      const res = await fetch(`guide/${params}.md`, { signal: abortSignal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },
  });

  protected readonly rendered = computed(() => {
    const md = this.doc.value();
    return md ? renderMarkdown(md) : null;
  });
  // Our own repository content, rendered at build-time sources: safe to trust.
  protected readonly html = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.rendered()?.html ?? ''),
  );

  private readonly index = computed(() => GUIDES.findIndex((g) => g.slug === this.slug()));
  protected readonly prev = computed(() => GUIDES[this.index() - 1]);
  protected readonly next = computed(() =>
    this.index() >= 0 ? GUIDES[this.index() + 1] : undefined,
  );
  protected readonly sourceUrl = computed(() => `${REPO_BLOB}/docs/guide/${this.slug()}.md`);

  constructor() {
    effect(() => {
      const r = this.rendered();
      if (r) this.title.setTitle(`${r.title} · Cadence docs`);
      // Honour a #fragment after the content has rendered.
      const fragment = this.router.parseUrl(this.router.url).fragment;
      if (r && fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView());
    });
  }

  /** Route internal links rendered from Markdown through the Angular router. */
  onContentClick(event: MouseEvent) {
    const a = (event.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href || a.target === '_blank' || event.metaKey || event.ctrlKey) return;
    if (href.startsWith('#')) {
      this.scrollTo(event, href.slice(1));
    } else if (href.startsWith('docs/')) {
      event.preventDefault();
      void this.router.navigateByUrl('/' + href);
    }
  }

  scrollTo(event: Event, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(history.state, '', `${location.pathname}#${id}`);
  }
}
