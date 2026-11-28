"use client";
import { useRef, useState } from "react";
import { CustomerPicker, type PickerCustomer } from "@/components/customer-picker";

/**
 * Cliente do agendamento + endereço do serviço. Ao escolher o cliente, o endereço da ficha aparece no campo;
 * dá para trocar só para este serviço. Se a ficha não tem endereço, o que for digitado vai para a ficha.
 */
export function AppointmentCustomer({ customers, defaultCustomer }: { customers: PickerCustomer[]; defaultCustomer?: string | null }) {
  const initial = customers.find((c) => c.id === defaultCustomer)?.address ?? "";
  const [address, setAddress] = useState(initial);
  const auto = useRef(initial); // último endereço preenchido sozinho: só ele é trocado ao mudar de cliente
  const [id, setId] = useState(defaultCustomer ?? "");
  const fromFile = customers.find((c) => c.id === id)?.address?.trim();
  const initialPhone = customers.find((c) => c.id === defaultCustomer)?.phone ?? "";
  const [phone, setPhone] = useState(initialPhone);
  const autoPhone = useRef(initialPhone);
  const phoneFile = customers.find((c) => c.id === id)?.phone?.trim();

  return (
    <fieldset>
      <legend>Cliente</legend>
      <div className="fields">
        <CustomerPicker label="Cliente cadastrado" customers={customers} defaultValue={defaultCustomer}
          onChange={(cid) => {
            setId(cid);
            const next = customers.find((c) => c.id === cid)?.address ?? "";
            if (!address.trim() || address === auto.current) { setAddress(next); auto.current = next; }
            const nextPhone = customers.find((c) => c.id === cid)?.phone ?? "";
            if (!phone.trim() || phone === autoPhone.current) { setPhone(nextPhone); autoPhone.current = nextPhone; }
          }} />
        <label>…ou novo cliente (nome)<input name="newName" placeholder="Nome" disabled={!!id} /></label>
        <label>Telefone do cliente
          <input name="phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="41 99999-0000" autoComplete="tel" />
        </label>
      </div>
      <small className="muted">
        {id && phoneFile ? (phone.replace(/\D/g, "") !== phoneFile.replace(/\D/g, "") && phone.trim() ? "Telefone diferente da ficha: ao salvar, a ficha é atualizada." : "Telefone da ficha. Aparece na agenda para o técnico ligar.")
          : id ? "A ficha deste cliente não tem telefone: o que você digitar fica salvo nela e aparece na agenda."
          : "O telefone aparece na agenda para o técnico ligar, se precisar."}
      </small>
      <label>Endereço do serviço
        <input name="address" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} autoComplete="street-address"
          placeholder="Rua, número, bairro, cidade" />
      </label>
      <small className="muted">
        {id && fromFile ? (address.trim() && address.trim() !== fromFile ? "Endereço diferente da ficha: vale só para este serviço." : "Endereço da ficha do cliente.")
          : id ? "A ficha deste cliente não tem endereço: o que você digitar fica salvo nela."
          : "Escolha o cliente para puxar o endereço da ficha."}
      </small>
    </fieldset>
  );
}
