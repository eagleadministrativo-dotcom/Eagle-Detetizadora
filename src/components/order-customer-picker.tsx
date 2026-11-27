"use client";
import { useEffect, useRef, useState } from "react";
import type { OpenAppointment } from "@/server/services/eagle";

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (ymd: string) => ymd.split("-").reverse().join("/");

/** Escolhe o agendamento que vale para o cliente: o próximo; se não houver, o mais recente. */
function pick(list: OpenAppointment[], today: string) {
  return list.find((a) => a.date >= today) ?? list[list.length - 1] ?? null;
}

/**
 * Cliente da OS nova. Se o cliente tem agendamento sem OS, a OS já fica ligada a ele
 * e a data, o horário, os serviços e o valor vêm preenchidos do agendamento.
 */
export function OrderCustomerPicker({ customers, appointments, initialCustomer, today }: {
  customers: { id: string; name: string; phone: string | null }[]; appointments: OpenAppointment[]; initialCustomer?: string; today: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [customer, setCustomer] = useState(initialCustomer ?? "");
  const list = appointments.filter((a) => a.customer_id === customer);
  const [appt, setAppt] = useState(() => pick(appointments.filter((a) => a.customer_id === initialCustomer), today)?.id ?? "");

  // preenche os campos da OS com os dados do agendamento escolhido
  useEffect(() => {
    const a = appointments.find((x) => x.id === appt);
    const form = box.current?.closest("form");
    if (!a || !form) return;
    const set = (name: string, v: string) => { const el = form.elements.namedItem(name); if (el instanceof HTMLInputElement) el.value = v; };
    set("serviceDate", a.date);
    set("serviceTime", a.time);
    if (a.total_cents) set("value", brl(a.total_cents));
    form.querySelectorAll<HTMLInputElement>('input[name="svc_os"]').forEach((c) => { c.checked = a.service_ids.includes(c.dataset.service ?? ""); });
  }, [appt, appointments]);

  return (
    <div ref={box} className="stack">
      <div className="fields">
        <label>Cliente
          <select name="customerId" value={customer} required onChange={(e) => { setCustomer(e.target.value); setAppt(pick(appointments.filter((a) => a.customer_id === e.target.value), today)?.id ?? ""); }}>
            <option value="">— escolher —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </label>
        {list.length ? (
          <label>Agendamento deste cliente
            <select name="appointmentId" value={appt} onChange={(e) => setAppt(e.target.value)}>
              <option value="">— OS sem agendamento —</option>
              {list.map((a) => <option key={a.id} value={a.id}>{fmt(a.date)} às {a.time} · {a.services || "sem serviço"} · {a.staff_name}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      {customer && !list.length ? <small className="muted">Este cliente não tem agendamento sem OS: preencha a data abaixo.</small> : null}
      {appt ? <small className="muted">Data, horário, serviços e valor vieram do agendamento. Dá para ajustar antes de criar.</small> : null}
    </div>
  );
}
