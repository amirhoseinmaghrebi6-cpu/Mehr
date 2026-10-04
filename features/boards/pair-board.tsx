"use client";

/**
 * Adding a board to a home (docs/board-protocol.md, "Pairing"): the owner or admin uploads the
 * pairing QR code the board showed on its own setup page (or pastes its text). Then every channel
 * of the board (1 to 20 inputs and outputs) gets a name and a room.
 *
 * The QR image is read in the browser by a library bundled with the app; nothing is sent anywhere
 * but our own API.
 */
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Fingerprint, QrCode, Upload, Wifi } from "lucide-react";
import { parsePairingCode, type Device, type Room } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { typeLabel } from "@/lib/device-ui";
import { formatNumber } from "@/lib/i18n";
import { gatewayMessage } from "@/lib/gateway-messages";
import { GatewayError } from "@/services/home-gateway";

/** The text of the QR code in an image file, or null if none can be read. */
async function readQrCode(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file);
    // Phone photos are large; a smaller copy reads just as well and much faster.
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    return jsQR(image.data, image.width, image.height)?.data ?? null;
  } catch {
    return null;
  }
}

type Props = {
  rooms: Room[];
  canPair: boolean;
  nameOf: (name: string) => string;
  onClose: () => void;
  /** Adds the board; resolves with its devices. */
  onPair: (pairingCode: string) => Promise<Device[]>;
  onRename: (device: Device, form: { name: string; roomId: string | null }) => Promise<void>;
};

export function PairBoard({ rooms, canPair, nameOf, onClose, onPair, onRename }: Props) {
  const { locale, m } = useI18n();
  const d = m.dialogs;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [forms, setForms] = useState<Record<string, { name: string; roomId: string }>>({});

  const pair = async (code: string) => {
    if (!parsePairingCode(code)) return setError(d.pairingInvalid);
    setBusy(true);
    setError("");
    try {
      const paired = await onPair(code.trim());
      setForms(Object.fromEntries(paired.map((device) => [device.id, { name: device.name, roomId: rooms[0]?.id ?? "" }])));
      setDevices(paired);
    } catch (caught) {
      const code = caught instanceof GatewayError ? caught.code : "network";
      setError(code === "not_found" ? d.pairingNotFound : gatewayMessage(code, locale));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    const code = await readQrCode(file);
    if (!code) return setError(d.qrUnreadable);
    setText(code);
    await pair(code);
  };

  const saveNames = async (event: FormEvent) => {
    event.preventDefault();
    if (!devices) return;
    setBusy(true);
    setError("");
    try {
      for (const device of devices) {
        const form = forms[device.id];
        await onRename(device, { name: form.name.trim() || device.name, roomId: form.roomId || null });
      }
      onClose();
    } catch (caught) {
      setError(gatewayMessage(caught instanceof GatewayError ? caught.code : "network", locale));
    } finally {
      setBusy(false);
    }
  };

  if (devices) {
    return (
      <form className="workspace-form" onSubmit={saveNames}>
        <p className="workspace-dialog-description">{d.nameChannelsText(formatNumber(devices.length, locale))}</p>
        <div className="channel-list">
          {devices.map((device) => (
            <div className="channel-row" key={device.id}>
              <span className="channel-type">{typeLabel(device.type, locale)}</span>
              <input aria-label={d.deviceName} maxLength={60} value={forms[device.id].name} onChange={(event) => setForms((current) => ({ ...current, [device.id]: { ...current[device.id], name: event.target.value } }))} />
              <select aria-label={d.space} value={forms[device.id].roomId} onChange={(event) => setForms((current) => ({ ...current, [device.id]: { ...current[device.id], roomId: event.target.value } }))}>
                <option value="">{d.noSpace}</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{nameOf(room.name)}</option>)}
              </select>
            </div>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="workspace-form-actions"><button type="submit" className="button-primary" disabled={busy}><Check size={15} />{d.saveAndFinish}</button></div>
      </form>
    );
  }

  return (
    <>
      <p className="workspace-dialog-description">{d.realAddText}</p>
      <ol className="pairing-steps">
        <li><Fingerprint size={15} />{d.pairingSteps[0]}</li>
        <li><Wifi size={15} />{d.pairingSteps[1]}</li>
        <li><QrCode size={15} />{d.pairingSteps[2]}</li>
      </ol>
      {canPair ? (
        <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); void pair(text); }}>
          <label className={`qr-upload${busy ? " is-busy" : ""}`}>
            <Upload size={16} /><span>{d.uploadQr}</span>
            <input type="file" accept="image/*" onChange={(event) => void upload(event)} disabled={busy} />
          </label>
          <label className="form-field"><span>{d.orPasteCode}</span><input dir="ltr" value={text} onChange={(event) => setText(event.target.value)} placeholder="M2P1:…" maxLength={200} autoComplete="off" spellCheck={false} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="workspace-form-actions">
            <button type="button" className="button-subtle" onClick={onClose}>{m.common.cancel}</button>
            <button type="submit" className="button-primary" disabled={busy || !text.trim()}><Check size={15} />{d.addBoard}</button>
          </div>
        </form>
      ) : (
        <>
          <p className="form-note">{d.membersCannotPair}</p>
          <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{m.common.gotIt}</button></div>
        </>
      )}
    </>
  );
}
