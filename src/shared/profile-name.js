export const NAME_LIMIT = 60;

export function chosenName(value) {
  if (typeof value !== 'string') throw new Error('Enter your name.');
  const name = value.trim().normalize('NFC');
  if (!name) throw new Error('Enter your name.');
  if ([...name].length > NAME_LIMIT) throw new Error('Use up to 60 characters for your name.');
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new Error('Use a name without line breaks or control characters.');
  return name;
}
