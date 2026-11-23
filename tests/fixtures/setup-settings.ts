import { expect, type Locator } from '@playwright/test';

export async function configureDarts(setup: Locator, name: string) {
  const cricket = name.startsWith('Cricket');
  await expect(setup.getByRole('switch', { name: /^Jouer au (X01|Cricket)$/ })).toHaveCount(0);
  if (cricket)
    await setup
      .getByRole('switch', { name: 'Compter les points', exact: true })
      .setChecked(!name.includes('sans points'));
  else {
    await setup
      .getByLabel('Score de départ', { exact: true })
      .selectOption(String(Number.parseInt(name, 10)));
    await setup
      .getByRole('switch', { name: 'Sortie double', exact: true })
      .setChecked(name.endsWith('double'));
  }
  if (cricket)
    await expect(
      setup.getByRole('switch', { name: 'Compter les points', exact: true }),
    ).toBeChecked({ checked: !name.includes('sans points') });
  else {
    await expect(setup.getByLabel('Score de départ', { exact: true })).toHaveValue(
      String(Number.parseInt(name, 10)),
    );
    await expect(setup.getByRole('switch', { name: 'Sortie double', exact: true })).toBeChecked({
      checked: name.endsWith('double'),
    });
  }
}
