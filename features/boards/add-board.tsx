"use client";

/**
 * Adding a device to a home, in three steps:
 * 1. pick the product (a board model) from the catalog, by category;
 * 2. name its channels (1 to 20 inputs and outputs) and put them in rooms: they join the home
 *    at once, waiting for pairing;
 * 3. pair, now or later: the app gives a setup code, and the real board, in pairing mode, takes it
 *    on its own setup page (a link opens that page with the code filled in, or it is typed). The
 *    board then joins on its own; the devices stop waiting, and this step says so
 *    (docs/board-protocol.md, "Pairing").
 *
 * The real board must be the product that was picked. In the demo, a button plays the board.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, ChevronRight, CircleCheck, ExternalLink, Fingerprint, Hourglass, LoaderCircle, RefreshCw, Sparkles, Wifi } from "lucide-react";
import { productCategories, type Device, type HardwareProduct, type Room, type SetupCodeResponse } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { deviceTypeInfo, typeLabel } from "@/lib/device-ui";
import { formatNumber, formatTime } from "@/lib/i18n";
import { gatewayMessage } from "@/lib/gateway-messages";
import { GatewayError } from "@/services/home-gateway";

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
  /** A setup code for the waiting board (a new one ends the earlier). */
  createSetupCode: (board: WaitingBoard) => Promise<SetupCodeResponse>;
  /** Whether the real board has joined (its devices no longer wait); the home's live updates tell. */
  isPaired: (boardId: string) => boolean;
  /** Demo only: plays the real board using the code. */
  simulateBoard?: (board: WaitingBoard) => Promise<void>;
  onClose: () => void;
};

export function AddBoard({ rooms, canPair, nameOf, waiting, loadProducts, onAdd, createSetupCode, isPaired, simulateBoard, onClose }: Props) {
  const { locale, m, rtl } = useI18n();
  const d = m.dialogs;
  const [products, setProducts] = useState<HardwareProduct[] | null>(null);
  const [product, setProduct] = useState<HardwareProduct | null>(null);
  const [forms, setForms] = useState<Record<string, { name: string; roomId: string }>>({});
  const [board, setBoard] = useState<WaitingBoard | null>(waiting ?? null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  // --- Step 3: pairing ---------------------------------------------------------------------------
  if (board) {
    return canPair ? (
      <Pairing board={board} nameOf={nameOf} createSetupCode={createSetupCode} isPaired={isPaired} simulateBoard={simulateBoard} onClose={onClose} />
    ) : (
      <>
        <p className="workspace-dialog-description">{d.pairBoardText(nameOf(board.boardName))}</p>
        <p className="form-note">{d.membersCannotPair}</p>
        <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{m.common.gotIt}</button></div>
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
          <button type="button" className="button-subtle" onClick={() => { setProduct(null); setError(""); }}><ArrowLeft size={14} />{m.common.back}</button>
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

/** Step 3: the setup code, the way to the board's page, and waiting until the board has joined. */
function Pairing({ board, nameOf, createSetupCode, isPaired, simulateBoard, onClose }: Pick<Props, "nameOf" | "createSetupCode" | "isPaired" | "simulateBoard" | "onClose"> & { board: WaitingBoard }) {
  const { locale, m } = useI18n();
  const d = m.dialogs;
  const [setup, setSetup] = useState<SetupCodeResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const paired = isPaired(board.boardId);
  const message = (caught: unknown) => gatewayMessage(caught instanceof GatewayError ? caught.code : "network", locale);

  // One request at a time: each new code ends the earlier one, so two at once could leave the
  // screen showing a code that no longer works.
  const requesting = useRef(false);
  const create = useRef(createSetupCode);
  create.current = createSetupCode;
  const newCode = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    setError("");
    try {
      setSetup(await create.current(board));
    } catch (caught) {
      setError(gatewayMessage(caught instanceof GatewayError ? caught.code : "network", locale));
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }, [board, locale]);
  // The first code, once per board (not again when the language changes).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void newCode(), [board.boardId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  if (paired) {
    return (
      <div className="pairing-done" role="status">
        <CircleCheck size={34} />
        <strong>{d.boardPairedTitle}</strong>
        <p>{d.boardPairedText}</p>
        <div className="workspace-form-actions single-action"><button type="button" className="button-primary" onClick={onClose}><Check size={15} />{m.common.gotIt}</button></div>
      </div>
    );
  }

  const expired = setup !== null && new Date(setup.expiresAt).getTime() <= now;
  const simulate = async () => {
    if (!simulateBoard) return;
    setBusy(true);
    try {
      await simulateBoard(board);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="workspace-dialog-description">{d.pairBoardText(nameOf(board.boardName))}</p>
      <ol className="pairing-steps">
        <li><Fingerprint size={15} />{d.pairingSteps[0]}</li>
        <li><Wifi size={15} />{d.pairingSteps[1]}</li>
        <li><ExternalLink size={15} />{d.pairingSteps[2]}</li>
      </ol>
      <div className={`setup-code-box${expired ? " is-expired" : ""}`}>
        <span className="panel-overline">{d.setupCode}</span>
        <strong dir="ltr">{setup?.code ?? "····-····-····"}</strong>
        {setup && <small>{expired ? d.codeExpired : d.setupCodeValid(formatTime(new Date(setup.expiresAt), locale, Intl.DateTimeFormat().resolvedOptions().timeZone))}</small>}
        {!simulateBoard && <small>{d.typeCodeNote}</small>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {simulateBoard ? (
        <>
          <p className="form-note">{d.demoSetupNote}</p>
          <button type="button" className="button-primary pairing-open" disabled={busy || !setup || expired} onClick={() => void simulate()}><Sparkles size={15} />{d.demoSimulate}</button>
        </>
      ) : (
        setup && !expired && <a className="button-primary pairing-open" href={setup.setupUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />{d.openBoardPage}</a>
      )}
      {setup && !expired && <p className="pairing-waiting" role="status"><LoaderCircle size={14} className="spin" />{d.waitingForBoard}</p>}
      <div className="workspace-form-actions">
        <button type="button" className="button-subtle" onClick={onClose}><Hourglass size={14} />{d.pairLater}</button>
        <button type="button" className="button-subtle" onClick={() => void newCode()} disabled={busy}><RefreshCw size={14} />{d.newCode}</button>
      </div>
    </>
  );
}
