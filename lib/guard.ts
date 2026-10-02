export function notFound(): Response {
  return Response.json({ error: "Не найдено." }, { status: 404 });
}

export function owned(owner: string, patientId: string): Response | null {
  return owner === patientId ? null : notFound();
}
