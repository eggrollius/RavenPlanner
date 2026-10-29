import { expect, test, type Page } from '@playwright/test';

async function addCourse(page: Page, department: string, number: string) {
  await page.getByLabel('Department').fill(department);
  await page.getByLabel('Course number').fill(number);
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByRole('button', { name: `Remove ${department} ${number}` })).toBeVisible();
}

test('plans courses with lectures and tutorials using the local catalog', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Fall 2026')).toBeVisible();
  await addCourse(page, 'COMP', '1405');
  await expect(page.getByRole('heading', { name: '4 conflict-free options' })).toBeVisible();
  await expect(page.locator('.class-block').first()).toContainText('COMP 1405');
  await addCourse(page, 'MATH', '1007');
  await addCourse(page, 'PSYC', '1001');
  await expect(page.locator('.class-block').filter({ hasText: 'MATH 1007' }).first()).toBeVisible();
  await expect(page.locator('.class-block').filter({ hasText: 'PSYC 1001' }).first()).toBeVisible();

  const next = page.getByRole('button', { name: 'Next schedule', exact: true });
  await next.click();
  await expect(page.locator('.pager b')).toHaveText('2');
  const comp = page.getByRole('article', { name: 'COMP 1405' });
  await comp.locator('summary').click();
  await comp.getByRole('checkbox').first().uncheck();
  await expect(page.locator('.pager b')).toHaveText('1');
  await page.getByRole('button', { name: 'Remove MATH 1007' }).click();
  await expect(page.getByRole('heading', { name: 'Elementary Calculus I' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove COMP 1405' }).click();
  await page.getByRole('button', { name: 'Remove PSYC 1001' }).click();
  await expect(page.getByText('Your course list is empty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('switches demo catalogs and retains unscheduled classes in their term plan', async ({ page }) => {
  await page.goto('/');
  await addCourse(page, 'CGSC', '1001');
  await expect(page.getByRole('heading', { name: 'Unscheduled classes 1' })).toBeVisible();
  await expect(page.getByText('This option has no scheduled class times.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Academic term: Fall 2026' }).click();
  await expect(page.getByRole('listbox', { name: 'Academic term' }).getByRole('option')).toHaveCount(3);
  await page.getByRole('option', { name: 'Summer 2026' }).click();
  await expect(page.getByText('Your course list is empty')).toBeVisible();
  await addCourse(page, 'COMP', '1405');
  await page.getByRole('button', { name: 'Academic term: Summer 2026' }).click();
  await page.getByRole('option', { name: 'Fall 2026' }).click();
  await expect(page.getByRole('button', { name: 'Remove CGSC 1001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove COMP 1405' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Unscheduled classes 1' })).toBeVisible();
});

test('shows missing-course and duplicate-course errors', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Department').fill('COMP');
  await page.getByLabel('Course number').fill('9999');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByRole('alert')).toContainText('No course found matching the query');
  await addCourse(page, 'COMP', '1405');
  await page.getByRole('button', { name: 'Add course' }).click();
  await expect(page.getByRole('alert')).toContainText('COMP 1405 is already in your plan.');
});
