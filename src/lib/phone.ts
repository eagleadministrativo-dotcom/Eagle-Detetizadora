/** "41999991111" → "(41) 99999-1111"; "4133332222" → "(41) 3333-2222". Outros formatos voltam como vieram. */
export function fmtPhone(p: string | null | undefined): string {
  if (!p) return "";
  let d = p.replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}
