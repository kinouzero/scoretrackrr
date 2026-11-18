import { expect, type Locator } from '@playwright/test';

export async function configureDarts(setup: Locator, name: string) {
  const cricket = name.startsWith('Cricket');
  await setup.getByRole('switch', { name: /^Jouer au (X01|Cricket)$/ }).setChecked(cricket);
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
  await expect(
    setup.getByRole('switch', { name: cricket ? 'Jouer au Cricket' : 'Jouer au X01', exact: true }),
  ).toBeChecked({
    checked: cricket,
  });
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
