"use client";

/**
 * Adding a device to a home, in three steps:
 * 1. pick the product (a board model) from the catalog, by category;
 * 2. name its channels (1 to 20 inputs and outputs) and put them in rooms: they join the home
 *    at once, waiting for pairing;
 * 3. pair: upload the QR code the real board showed on its own setup page (or paste its text),
 *    now or later (docs/board-protocol.md, "Pairing").
 *
 * The real board must be the product that was picked. The QR image is read in the browser by a
 * library bundled with the app; nothing is sent anywhere but our own API.
 */
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Fingerprint, Hourglass, QrCode, Upload, Wifi } from "lucide-react";
import { parsePairingCode, productCategories, type Device, type HardwareProduct, type Room } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { deviceTypeInfo, typeLabel } from "@/lib/device-ui";
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

/** A board that is in the home and waits for pairing. */
export type WaitingBoard = { boardId: string; boardName: string };

type Props = {
  rooms: Room[];
  /** Owners and admins add and pair boards; members only read how it is done. */
  canPair: boolean;
  nameOf: (name: string) => string;
  /** Opens directly on pairing, for a board added earlier. */
  waiting?: WaitingBoard;
  loadProducts: () => Promise<HardwareProduct[]>;
  /** Adds the product to the home; its devices then wait for pairing. */
  onAdd: (product: HardwareProduct, channels: Array<{ key: string; name: string; roomId: string | null }>) => Promise<WaitingBoard>;
  onPair: (board: WaitingBoard, pairingCode: string) => Promise<void>;
  /** Demo only: the sample QR code of a waiting board's product, to save and upload. */
  sampleQr?: (boardId: string) => { label: string; image: string } | null;
  onClose: () => void;
};

export function AddBoard({ rooms, canPair, nameOf, waiting, loadProducts, onAdd, onPair, sampleQr, onClose }: Props) {
  const { locale, m, rtl } = useI18n();
  const d = m.dialogs;
  const [products, setProducts] = useState<HardwareProduct[] | null>(null);
  const [product, setProduct] = useState<HardwareProduct | null>(null);
  const [forms, setForms] = useState<Record<string, { name: string; roomId: string }>>({});
  const [board, setBoard] = useState<WaitingBoard | null>(waiting ?? null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const Back = rtl ? ArrowRight : ArrowLeft;

  useEffect(() => {
    if (waiting) return;
    let current = true;
    loadProducts().then(
      (list) => current && setProducts(list),
      (caught: unknown) => current && setError(gatewayMessage(caught instanceof GatewayError ? caught.code : "network", locale)),
    );
    return () => {
      current = false;
    };
  }, [waiting, loadProducts, locale]);

  const fail = (caught: unknown, messages: Partial<Record<string, string>> = {}) => {
    const code = caught instanceof GatewayError ? caught.code : "network";
    setError(messages[code] ?? gatewayMessage(code, locale));
  };

  const pick = (picked: HardwareProduct) => {
    setProduct(picked);
    setError("");
    setForms(Object.fromEntries(picked.channels.map((channel) => [channel.key, { name: nameOf(channel.defaultName), roomId: rooms[0]?.id ?? "" }])));
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!product) return;
    setBusy(true);
    setError("");
    try {
      setBoard(await onAdd(product, product.channels.map((channel) => ({ key: channel.key, name: forms[channel.key].name.trim() || nameOf(channel.defaultName), roomId: forms[channel.key].roomId || null }))));
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(false);
    }
  };

  const pair = async (code: string) => {
    if (!board) return;
    if (!parsePairingCode(code)) return setError(d.pairingInvalid);
    setBusy(true);
    setError("");
    try {
      await onPair(board, code.trim());
      onClose();
    } catch (caught) {
      fail(caught, { not_found: d.pairingNotFound, conflict: d.pairingWrongProduct });
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

  // --- Step 3: pairing ---------------------------------------------------------------------------
  if (board) {
    const sample = sampleQr?.(board.boardId);
    return (
      <>
        <p className="workspace-dialog-description">{d.pairBoardText(nameOf(board.boardName))}</p>
        <ol className="pairing-steps">
          <li><Fingerprint size={15} />{d.pairingSteps[0]}</li>
          <li><Wifi size={15} />{d.pairingSteps[1]}</li>
          <li><QrCode size={15} />{d.pairingSteps[2]}</li>
        </ol>
        {sample && (
          <div className="sample-boards">
            <span>{d.demoSampleBoards}</span>
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element -- a small static QR image; the user saves the file itself */}
              <a href={sample.image} download title={sample.label}><img src={sample.image} alt="" width={54} height={54} /><span>{sample.label}</span></a>
            </div>
          </div>
        )}
        {canPair ? (
          <form className="workspace-form" onSubmit={(event) => { event.preventDefault(); void pair(text); }}>
            <label className={`qr-upload${busy ? " is-busy" : ""}`}>
              <Upload size={16} /><span>{d.uploadQr}</span>
              <input type="file" accept="image/*" onChange={(event) => void upload(event)} disabled={busy} />
            </label>
            <label className="form-field"><span>{d.orPasteCode}</span><input dir="ltr" value={text} onChange={(event) => setText(event.target.value)} placeholder="M2P1:…" maxLength={200} autoComplete="off" spellCheck={false} /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="workspace-form-actions">
              <button type="button" className="button-subtle" onClick={onClose}><Hourglass size={14} />{d.pairLater}</button>
              <button type="submit" className="button-primary" disabled={busy || !text.trim()}><Check size={15} />{d.pairNow}</button>
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

  // --- Step 2: names and rooms -------------------------------------------------------------------
  if (product) {
    return (
      <form className="workspace-form" onSubmit={add}>
        <p className="workspace-dialog-description">{d.nameChannelsText(nameOf(product.name), formatNumber(product.channels.length, locale))}</p>
        <div className="channel-list">
          {product.channels.map((channel) => (
            <div className="channel-row" key={channel.key}>
              <span className="channel-type">{typeLabel(channel.deviceType, locale)}</span>
              <input aria-label={d.deviceName} maxLength={60} value={forms[channel.key].name} onChange={(event) => setForms((current) => ({ ...current, [channel.key]: { ...current[channel.key], name: event.target.value } }))} />
              <select aria-label={d.space} value={forms[channel.key].roomId} onChange={(event) => setForms((current) => ({ ...current, [channel.key]: { ...current[channel.key], roomId: event.target.value } }))}>
                <option value="">{d.noSpace}</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{nameOf(room.name)}</option>)}
              </select>
            </div>
          ))}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="workspace-form-actions">
          <button type="button" className="button-subtle" onClick={() => { setProduct(null); setError(""); }}><Back size={14} />{m.common.back}</button>
          <button type="submit" className="button-primary" disabled={busy}><Check size={15} />{d.addToHome}</button>
        </div>
      </form>
    );
  }

  // --- Step 1: the product -----------------------------------------------------------------------
  const summary = (item: HardwareProduct) => {
    const counts = new Map<string, number>();
    for (const channel of item.channels) counts.set(channel.deviceType, (counts.get(channel.deviceType) ?? 0) + 1);
    return [...counts].map(([type, count]) => (count > 1 ? `${typeLabel(type as Device["type"], locale)} × ${formatNumber(count, locale)}` : typeLabel(type as Device["type"], locale))).join(rtl ? "، " : ", ");
  };
  return (
    <>
      <p className="workspace-dialog-description">{d.pickProductText}</p>
      {!canPair ? (
        <>
          <p className="form-note">{d.membersCannotPair}</p>
          <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{m.common.gotIt}</button></div>
        </>
      ) : (
        <>
          {error && <p className="form-error" role="alert">{error}</p>}
          {!products && !error && <p className="form-note" role="status">{d.loadingProducts}</p>}
          {products && products.length === 0 && <p className="form-note">{d.noProducts}</p>}
          <div className="product-list">
            {productCategories.map((category) => {
              const items = (products ?? []).filter((item) => item.category === category);
              if (!items.length) return null;
              return (
                <section key={category}>
                  <span className="panel-overline">{d.categories[category]}</span>
                  {items.map((item) => {
                    const Icon = deviceTypeInfo[item.channels[0].deviceType].icon;
                    return (
                      <button type="button" className="product-row" key={item.code} onClick={() => pick(item)}>
                        <span className={`product-icon device-icon-${deviceTypeInfo[item.channels[0].deviceType].tone}`}><Icon size={18} strokeWidth={1.7} /></span>
                        <span className="product-copy"><strong>{nameOf(item.name)}</strong><small>{summary(item)}</small></span>
                        <ChevronRight size={16} className="product-arrow" />
                      </button>
                    );
                  })}
                </section>
              );
            })}
          </div>
          <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{m.common.cancel}</button></div>
        </>
      )}
    </>
  );
}
