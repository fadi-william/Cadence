import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import {
  FormField,
  applyWhen,
  email,
  form,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import type { OrgTreeManager, OrgTreeTribeLead } from '@cadence/shared';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { Avatar } from '../../shared/avatar';
import { CopyButton } from '../../shared/copy-button';
import { Field, isInvalid } from '../../shared/field';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';

type Kind = 'TRIBE_LEAD' | 'ENGINEERING_MANAGER' | 'MEMBER';
interface Draft {
  kind: Kind;
  parentId?: string;
  parentName?: string;
}
interface PersonForm {
  name: string;
  email: string;
  tribeName: string;
  title: string;
  password: string;
}
const EMPTY: PersonForm = { name: '', email: '', tribeName: '', title: '', password: '' };

@Component({
  selector: 'app-org-page',
  imports: [FormField, RouterLink, Avatar, CopyButton, Field, Icon, PageHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './org.page.html',
})
export class OrgPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthStore);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly linkDialog = viewChild.required<ElementRef<HTMLDialogElement>>('linkDialog');
  protected readonly invalid = isInvalid;
  protected readonly link = signal<{
    url: string;
    expiresAt: string;
    emailed: boolean;
    name: string;
  } | null>(null);

  protected readonly tree = resource({ loader: () => this.api.orgTree() });
  protected readonly tribeLeads = computed(() => this.tree.value()?.tribeLeads ?? []);

  protected readonly draft = signal<Draft | null>(null);
  protected readonly isMember = computed(() => this.draft()?.kind === 'MEMBER');
  protected readonly model = signal<PersonForm>({ ...EMPTY });
  protected readonly pf = form(this.model, (p) => {
    required(p.name, { message: 'Enter a name' });
    email(p.email, { message: 'Enter a valid e-mail' });
    applyWhen(
      p,
      () => !this.isMember(),
      (q) => {
        required(q.email, { message: 'E-mail is required to sign in' });
        required(q.password, { message: 'Set an initial password' });
        minLength(q.password, 12, { message: 'Use at least 12 characters' });
      },
    );
  });

  protected readonly dialogTitle = computed(
    () =>
      ({
        TRIBE_LEAD: 'New tribe lead',
        ENGINEERING_MANAGER: 'New engineering manager',
        MEMBER: 'New person',
      })[this.draft()?.kind ?? 'MEMBER'],
  );

  open(d: Draft) {
    this.draft.set(d);
    this.model.set({ ...EMPTY });
    this.pf().reset();
    this.dialog().nativeElement.showModal();
  }

  close() {
    this.dialog().nativeElement.close();
  }

  async save(event: Event) {
    event.preventDefault();
    const d = this.draft();
    if (!d) return;
    await submit(this.pf, async () => {
      const v = this.model();
      try {
        if (d.kind === 'MEMBER') {
          await this.api.createMember({
            name: v.name,
            email: v.email || undefined,
            title: v.title || undefined,
            managerId: d.parentId!,
          });
        } else {
          await this.api.createUser({
            name: v.name,
            email: v.email,
            password: v.password,
            role: d.kind,
            reportsToId: d.parentId,
            tribeName: v.tribeName || undefined,
          });
        }
        this.toast.success(`${v.name} added`);
        this.close();
        this.tree.reload();
      } catch (e) {
        this.toast.error(errorMessage(e));
      }
      return undefined;
    });
  }

  async resetLink(u: OrgTreeTribeLead | OrgTreeManager) {
    try {
      const res = await this.api.resetLink(u.id);
      this.link.set({ ...res, name: u.name, expiresAt: new Date(res.expiresAt).toLocaleString() });
      this.linkDialog().nativeElement.showModal();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async removeUser(u: OrgTreeTribeLead | OrgTreeManager) {
    if (!confirm(`Remove ${u.name}? They must have no reports or people.`)) return;
    try {
      await this.api.deleteUser(u.id);
      this.toast.success(`${u.name} removed`);
      this.tree.reload();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
