export async function request<T>(route: string, method = "GET"): Promise<T> {
  const response = await fetch(`api/${route}`, { method, cache: "no-store" });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
