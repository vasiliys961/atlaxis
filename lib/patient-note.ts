export function patientFileNote(note: string): string {
  if (note.startsWith("Gemini 3.8 записала снимок")) {
    return "Снимок прочитан. В разбор попали только строки, которые совпали со словарём показателей.";
  }
  if (note.startsWith("Gemini 3.8 вернула пустой JSON")) {
    return "На снимке не нашлось видимого текста. Числа с него в разбор не вошли.";
  }
  return note;
}
