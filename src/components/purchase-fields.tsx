"use client";
import { useState } from "react";

/** Forma de pagamento: no crédito aparecem as parcelas e o valor de cada uma. */
export function PaymentFields({ initial = "avista", installments = 1, total = "" }: { initial?: string; installments?: number; total?: string }) {
  const [pay, setPay] = useState(initial);
  const [n, setN] = useState(installments);
  const [t, setT] = useState(total);
  const cents = Math.round(Number((t || "0").replace(/[R$\s.]/g, "").replace(",", ".")) * 100) || 0;
  return (
    <div className="fields">
      <label>Valor total (R$)<input name="total" inputMode="decimal" value={t} onChange={(e) => setT(e.target.value)} placeholder="0,00" required /></label>
      <label>Pagamento<select name="payment" value={pay} onChange={(e) => setPay(e.target.value)}><option value="avista">À vista (Pix, débito, dinheiro)</option><option value="credito">Cartão de crédito</option></select></label>
      {pay === "credito" ? <label>Parcelas<select name="installments" value={n} onChange={(e) => setN(Number(e.target.value))}>{Array.from({ length: 24 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}×{cents ? ` de ${(cents / (i + 1) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}</option>)}</select></label> : null}
    </div>
  );
}
