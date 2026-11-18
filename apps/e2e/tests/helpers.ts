import { Page, expect } from "@playwright/test";

export const ADMIN = {
  email: "admin@cadence.local",
  password: "E2e-Admin-Password!",
};
export const TL = {
  name: "Ahmed Mostafa",
  email: "ahmed@e2e.io",
  password: "tribe-lead-pass-1",
  tribe: "Retail",
};
export const EM = {
  name: "Michael Ramzy",
  email: "michael@e2e.io",
  password: "manager-pass-123",
};
export const EM2 = {
  name: "Rana Abdelaziz",
  email: "rana@e2e.io",
  password: "manager-pass-456",
};

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("Your password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Fields of the "add" dialog on Teams & tribes, keyed by placeholder. */
const PERSON_FIELDS = {
  name: "Full name",
  email: "name@company.com",
  tribe: "e.g. Retail",
  title: "e.g. Senior Engineer",
  password: "At least 12 characters",
} as const;

export async function fillPersonDialog(
  page: Page,
  fields: Partial<Record<keyof typeof PERSON_FIELDS, string>>,
) {
  const dialog = page.locator("dialog[open]");
  for (const [key, value] of Object.entries(fields)) {
    await dialog
      .getByPlaceholder(PERSON_FIELDS[key as keyof typeof PERSON_FIELDS])
      .fill(value!);
  }
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
}

/** Sidebar navigation link (exact match, so page buttons with similar text don't collide). */
export const nav = (page: Page, name: string) =>
  page.locator("aside nav").getByRole("link", { name, exact: true });
