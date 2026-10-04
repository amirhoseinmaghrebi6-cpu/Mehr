"use client";

import { useState, type FormEvent } from "react";
import { Building2, Check, ChevronRight, Pencil, Plus, QrCode, Trash2, X } from "lucide-react";
import { can, defaultTimeZone, propertyTypes, type Device, type PhotoPreset, type Property, type PropertyType, type Room } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { AddBoard } from "@/features/boards/add-board";
import { photoPresetList, photoUrl, typeLabel } from "@/lib/device-ui";
import { formatNumber, offeredTimeZones, timeZoneCity, timeZoneOffset } from "@/lib/i18n";
import { gatewayMessage } from "@/lib/gateway-messages";
import { GatewayError } from "@/services/home-gateway";

type PropertyForm = { name: string; address: string; type: PropertyType; coverPhoto: PhotoPreset; timeZone: string };

/** Runs an async save, turning gateway errors into a message for the form. */
function useSaving() {
  const { locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (caught) {
      setError(gatewayMessage(caught instanceof GatewayError ? caught.code : "network", locale));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function PropertyManagerDialog({
  properties,
  selectedId,
  nameOf,
  onClose,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: {
  properties: Property[];
  selectedId: string | null;
  nameOf: (name: string) => string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: (form: PropertyForm) => Promise<void>;
  onUpdate: (id: string, form: PropertyForm) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { m, rtl } = useI18n();
  const d = m.dialogs;
  const [editing, setEditing] = useState<Property | null>(null);
  const [creating, setCreating] = useState(properties.length === 0);
  const [deleting, setDeleting] = useState<Property | null>(null);
  const saving = useSaving();

  const saveProperty = (form: PropertyForm) =>
    saving.run(async () => {
      if (creating) await onCreate(form);
      else if (editing) await onUpdate(editing.id, form);
      setCreating(false);
      setEditing(null);
    });

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog property-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="property-dialog-title" dir={rtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={m.common.close}><X size={18} /></button>
        {creating || editing ? (
          <>
            <span className="workspace-dialog-icon"><Building2 size={19} /></span>
            <span className="panel-overline">{d.propertyOverline}</span>
            <h2 id="property-dialog-title">{creating ? d.addHome : d.editProperty}</h2>
            <p className="workspace-dialog-description">{d.propertyDescription}</p>
            <PropertyFormView
              key={editing?.id ?? "new-property"}
              initial={editing ? { name: editing.name, address: editing.address, type: editing.type, coverPhoto: editing.coverPhoto, timeZone: editing.timeZone ?? defaultTimeZone } : { name: "", address: "", type: "house", coverPhoto: "living", timeZone: defaultTimeZone }}
              error={saving.error}
              busy={saving.busy}
              onBack={properties.length ? () => { setCreating(false); setEditing(null); saving.setError(""); } : undefined}
              onSave={saveProperty}
            />
          </>
        ) : deleting ? (
          <>
            <span className="workspace-dialog-icon delete-dialog-icon"><Trash2 size={19} /></span>
            <span className="panel-overline">{d.removeOverline}</span>
            <h2 id="property-dialog-title">{d.removeTitle(nameOf(deleting.name))}</h2>
            <p className="workspace-dialog-description">{d.removeText}</p>
            {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
            <div className="workspace-form-actions">
              <button type="button" className="button-subtle" onClick={() => setDeleting(null)}>{d.keepProperty}</button>
              <button type="button" className="button-danger" disabled={saving.busy} onClick={() => void saving.run(async () => { await onDelete(deleting.id); setDeleting(null); })}>{d.removeHome}</button>
            </div>
          </>
        ) : (
          <>
            <span className="workspace-dialog-icon"><Building2 size={19} /></span>
            <span className="panel-overline">{d.placesOverline}</span>
            <h2 id="property-dialog-title">{d.placesTitle}</h2>
            <p className="workspace-dialog-description">{d.placesText}</p>
            <div className="property-manager-list">
              {properties.map((property) => (
                <div className={`property-manager-row${selectedId === property.id ? " is-current" : ""}`} key={property.id}>
                  <button type="button" className="property-manager-select" onClick={() => onSelect(property.id)}>
                    <span className="property-manager-photo" style={{ backgroundImage: `url("${photoUrl(property.coverPhoto)}")` }} />
                    <span className="property-manager-copy"><strong>{nameOf(property.name)}</strong><small>{nameOf(property.address) || d.propertyTypes[property.type]} · {d.roles[property.role]}</small></span>
                    {selectedId === property.id ? <span className="property-current-check"><Check size={14} /></span> : <ChevronRight size={16} />}
                  </button>
                  {can(property.role, "property.edit") && <button type="button" className="entity-edit-button" onClick={() => setEditing(property)} aria-label={d.edit(nameOf(property.name))}><Pencil size={15} /></button>}
                  {can(property.role, "property.delete") && <button type="button" className="entity-delete-button" onClick={() => setDeleting(property)} aria-label={d.remove(nameOf(property.name))}><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
            <button type="button" className="workspace-add-button" onClick={() => setCreating(true)}><Plus size={16} />{d.addProperty}</button>
            <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{m.common.done}</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function PropertyFormView({ initial, error, busy, onBack, onSave }: { initial: PropertyForm; error: string; busy: boolean; onBack?: () => void; onSave: (form: PropertyForm) => void }) {
  const { locale, m } = useI18n();
  const d = m.dialogs;
  const [name, setName] = useState(initial.name);
  const [timeZone, setTimeZone] = useState(initial.timeZone);
  const zones = offeredTimeZones.includes(timeZone) ? offeredTimeZones : [timeZone, ...offeredTimeZones];
  const [address, setAddress] = useState(initial.address);
  const [type, setType] = useState<PropertyType>(initial.type);
  const [coverPhoto, setCoverPhoto] = useState<PhotoPreset>(initial.coverPhoto);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), address: address.trim(), type, coverPhoto, timeZone });
  };

  return (
    <form className="workspace-form" onSubmit={submit}>
      <PhotoPresetPicker value={coverPhoto} onChange={setCoverPhoto} />
      <label className="form-field"><span>{d.homeName}</span><input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={d.homeNamePlaceholder} /></label>
      <div className="form-two-columns">
        <label className="form-field"><span>{d.propertyType}</span><select value={type} onChange={(event) => setType(event.target.value as PropertyType)}>{propertyTypes.map((item) => <option key={item} value={item}>{d.propertyTypes[item]}</option>)}</select></label>
        <label className="form-field"><span>{d.address}</span><input maxLength={200} value={address} onChange={(event) => setAddress(event.target.value)} placeholder={d.addressPlaceholder} /></label>
      </div>
      <label className="form-field"><span>{d.timeZone}</span><select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>{zones.map((zone) => <option key={zone} value={zone}>{`${timeZoneCity(zone, locale)} (${timeZoneOffset(zone)})`}</option>)}</select></label>
      <p className="form-note">{d.timeZoneNote}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="workspace-form-actions">
        {onBack && <button type="button" className="button-subtle" onClick={onBack}>{m.common.back}</button>}
        <button type="submit" className="button-primary" disabled={busy}><Check size={15} />{d.saveHome}</button>
      </div>
    </form>
  );
}

export function RoomEditorDialog({ room, nameOf, canDelete, onClose, onSave, onDelete }: { room: Room | null; nameOf: (name: string) => string; canDelete: boolean; onClose: () => void; onSave: (form: { name: string; photo: PhotoPreset }) => Promise<void>; onDelete: () => Promise<void> }) {
  const { m, rtl } = useI18n();
  const d = m.dialogs;
  const [name, setName] = useState(room ? nameOf(room.name) : "");
  const [photo, setPhoto] = useState<PhotoPreset>(room?.photo ?? "living");
  const saving = useSaving();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    void saving.run(() => onSave({ name: name.trim(), photo }));
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" dir={rtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={m.common.close}><X size={18} /></button>
        <span className="workspace-dialog-icon"><Building2 size={19} /></span><span className="panel-overline">{d.spacesOverline}</span>
        <h2 id="room-dialog-title">{room ? d.editSpace : d.addSpace}</h2>
        <p className="workspace-dialog-description">{d.spaceDescription}</p>
        <form className="workspace-form" onSubmit={submit}>
          <PhotoPresetPicker value={photo} onChange={setPhoto} />
          <label className="form-field"><span>{d.spaceName}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={d.spaceNamePlaceholder} /></label>
          {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
          <div className="workspace-form-actions">
            {room && canDelete && <button type="button" className="button-danger-subtle" disabled={saving.busy} onClick={() => void saving.run(onDelete)}><Trash2 size={14} />{d.deleteSpace}</button>}
            <button type="button" className="button-subtle" onClick={onClose}>{m.common.cancel}</button>
            <button type="submit" className="button-primary" disabled={saving.busy}><Check size={15} />{d.saveSpace}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** Rename a device or move it to another space. Its hardware (board, pins, type) never changes here. */
export function DeviceDetailsDialog({
  device,
  name: currentName,
  rooms,
  siblings,
  canRemoveBoard,
  nameOf,
  onClose,
  onSave,
  onRemoveBoard,
}: {
  device: Device;
  name: string;
  rooms: Room[];
  /** Every device of the same board, this one included. */
  siblings: Device[];
  canRemoveBoard: boolean;
  nameOf: (name: string) => string;
  onClose: () => void;
  onSave: (form: { name: string; roomId: string | null; hidden: boolean }) => Promise<void>;
  onRemoveBoard: (boardId: string) => Promise<void>;
}) {
  const { locale, m, rtl } = useI18n();
  const d = m.dialogs;
  const [name, setName] = useState(currentName);
  const [roomId, setRoomId] = useState(device.roomId ?? "");
  const [hidden, setHidden] = useState(Boolean(device.hidden));
  const [removing, setRemoving] = useState(false);
  const saving = useSaving();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    void saving.run(() => onSave({ name: name.trim(), roomId: roomId || null, hidden }));
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="device-dialog-title" dir={rtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={m.common.close}><X size={18} /></button>
        {removing && device.boardId ? (
          <>
            <span className="workspace-dialog-icon delete-dialog-icon"><Trash2 size={19} /></span>
            <h2 id="device-dialog-title">{d.removeBoardQuestion(nameOf(device.boardName ?? ""))}</h2>
            <p className="workspace-dialog-description">{d.removeBoardText(formatNumber(siblings.length, locale))}</p>
            <ul className="board-devices">{siblings.map((item) => <li key={item.id}>{nameOf(item.name)}<small>{typeLabel(item.type, locale)}</small></li>)}</ul>
            <p className="form-note">{d.removeBoardNote}</p>
            {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
            <div className="workspace-form-actions">
              <button type="button" className="button-subtle" onClick={() => { saving.setError(""); setRemoving(false); }}>{d.keepBoard}</button>
              <button type="button" className="button-danger" disabled={saving.busy} onClick={() => void saving.run(() => onRemoveBoard(device.boardId!))}><Trash2 size={15} />{d.removeBoard}</button>
            </div>
          </>
        ) : (
          <>
            <span className="workspace-dialog-icon"><Pencil size={18} /></span><span className="panel-overline">{typeLabel(device.type, locale)}</span>
            <h2 id="device-dialog-title">{d.nameAndSpace}</h2>
            <form className="workspace-form" onSubmit={submit}>
              <label className="form-field"><span>{d.deviceName}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label className="form-field"><span>{d.space}</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">{d.noSpace}</option>{rooms.map((room) => <option key={room.id} value={room.id}>{nameOf(room.name)}</option>)}</select></label>
              <label className="check-field"><input type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} /><span><strong>{d.hideDevice}</strong><small>{d.hideDeviceNote}</small></span></label>
              {device.boardId && (
                <div className="board-box">
                  <span className="panel-overline">{d.boardOfDevice}</span>
                  <strong>{nameOf(device.boardName ?? "")}</strong>
                  <small>{d.boardDevices(formatNumber(siblings.length, locale))}: {siblings.map((item) => nameOf(item.name)).join(rtl ? "، " : ", ")}</small>
                  {canRemoveBoard && <button type="button" className="text-action board-remove" onClick={() => setRemoving(true)}><Trash2 size={14} />{d.removeBoard}</button>}
                </div>
              )}
              {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
              <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={onClose}>{m.common.cancel}</button><button type="submit" className="button-primary" disabled={saving.busy}><Check size={15} />{m.common.save}</button></div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export function AddDeviceDialog(props: Parameters<typeof AddBoard>[0]) {
  const { m, rtl } = useI18n();
  const d = m.dialogs;
  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="workspace-dialog add-board-dialog" role="dialog" aria-modal="true" aria-labelledby="add-device-title" dir={rtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={props.onClose} aria-label={m.common.close}><X size={18} /></button>
        <span className="workspace-dialog-icon">{props.waiting ? <QrCode size={19} /> : <Plus size={19} />}</span><span className="panel-overline">{d.devicesOverline}</span>
        <h2 id="add-device-title">{props.waiting ? d.pairBoardTitle : d.addDevice}</h2>
        <AddBoard {...props} />
      </section>
    </div>
  );
}

function PhotoPresetPicker({ value, onChange }: { value: PhotoPreset; onChange: (preset: PhotoPreset) => void }) {
  const { m } = useI18n();
  return (
    <div className="photo-preset-grid" role="radiogroup" aria-label={m.dialogs.photo}>
      {photoPresetList.map((preset) => (
        <button key={preset} type="button" role="radio" aria-checked={value === preset} className={`photo-preset${value === preset ? " selected" : ""}`} style={{ backgroundImage: `url("${photoUrl(preset)}")` }} onClick={() => onChange(preset)}>
          <span>{m.dialogs.photos[preset]}</span>
          {value === preset && <Check size={13} />}
        </button>
      ))}
    </div>
  );
}
