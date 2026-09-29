"use client";

import { useState, type FormEvent } from "react";
import { Building2, Check, ChevronRight, Cpu, Pencil, Plus, QrCode, Trash2, X } from "lucide-react";
import { can, deviceTypeNames, type Device, type DeviceType, type PhotoPreset, type Property, type PropertyType, type Room } from "@m2smart/contracts";
import type { Locale } from "@/lib/i18n";
import { deviceTypeInfo, photoOptions, photoUrl, text } from "@/lib/device-ui";
import { gatewayMessage } from "@/lib/gateway-messages";
import { GatewayError } from "@/services/home-gateway";

const propertyTypes: { value: PropertyType; en: string; fa: string }[] = [
  { value: "house", en: "House", fa: "خانه" },
  { value: "villa", en: "Villa", fa: "ویلا" },
  { value: "apartment", en: "Apartment", fa: "آپارتمان" },
  { value: "office", en: "Office", fa: "دفتر کار" },
  { value: "commercial", en: "Shop / commercial", fa: "مغازه / تجاری" },
  { value: "custom", en: "Other", fa: "سایر" },
];

type PropertyForm = { name: string; address: string; type: PropertyType; coverPhoto: PhotoPreset };

/** Runs an async save, turning gateway errors into a message for the form. */
function useSaving(locale: Locale) {
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
  locale,
  nameOf,
  onClose,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: {
  properties: Property[];
  selectedId: string | null;
  locale: Locale;
  nameOf: (name: string) => string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: (form: PropertyForm) => Promise<void>;
  onUpdate: (id: string, form: PropertyForm) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const isRtl = locale === "fa";
  const [editing, setEditing] = useState<Property | null>(null);
  const [creating, setCreating] = useState(properties.length === 0);
  const [deleting, setDeleting] = useState<Property | null>(null);
  const saving = useSaving(locale);

  const saveProperty = (form: PropertyForm) =>
    saving.run(async () => {
      if (creating) await onCreate(form);
      else if (editing) await onUpdate(editing.id, form);
      setCreating(false);
      setEditing(null);
    });

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog property-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="property-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        {creating || editing ? (
          <>
            <span className="workspace-dialog-icon"><Building2 size={19} /></span>
            <span className="panel-overline">{isRtl ? "مدیریت ملک‌ها" : "PROPERTY DETAILS"}</span>
            <h2 id="property-dialog-title">{isRtl ? (creating ? "خانه‌ی جدید" : "ویرایش ملک") : creating ? "Add a home" : "Edit property"}</h2>
            <p className="workspace-dialog-description">{isRtl ? "نام، نوع، نشانی و تصویر خانه را تنظیم کنید." : "Set a name, type, address and cover photo for this place."}</p>
            <PropertyFormView
              key={editing?.id ?? "new-property"}
              initial={editing ? { name: editing.name, address: editing.address, type: editing.type, coverPhoto: editing.coverPhoto } : { name: "", address: "", type: "house", coverPhoto: "living" }}
              locale={locale}
              error={saving.error}
              busy={saving.busy}
              onBack={properties.length ? () => { setCreating(false); setEditing(null); saving.setError(""); } : undefined}
              onSave={saveProperty}
            />
          </>
        ) : deleting ? (
          <>
            <span className="workspace-dialog-icon delete-dialog-icon"><Trash2 size={19} /></span>
            <span className="panel-overline">{isRtl ? "تأیید حذف" : "REMOVE PROPERTY"}</span>
            <h2 id="property-dialog-title">{isRtl ? `«${nameOf(deleting.name)}» حذف شود؟` : `Remove ${nameOf(deleting.name)}?`}</h2>
            <p className="workspace-dialog-description">{isRtl ? "همه‌ی فضاها، بردها و دستگاه‌های این خانه برای همه‌ی اعضا حذف می‌شوند. این کار قابل بازگشت نیست." : "All its rooms, boards and devices are removed for every member. This can’t be undone."}</p>
            {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
            <div className="workspace-form-actions">
              <button type="button" className="button-subtle" onClick={() => setDeleting(null)}>{isRtl ? "انصراف" : "Keep property"}</button>
              <button type="button" className="button-danger" disabled={saving.busy} onClick={() => void saving.run(async () => { await onDelete(deleting.id); setDeleting(null); })}>{isRtl ? "حذف خانه" : "Remove home"}</button>
            </div>
          </>
        ) : (
          <>
            <span className="workspace-dialog-icon"><Building2 size={19} /></span>
            <span className="panel-overline">{isRtl ? "فضاهای متصل" : "YOUR PLACES"}</span>
            <h2 id="property-dialog-title">{isRtl ? "خانه‌ها و ملک‌ها" : "Homes & properties"}</h2>
            <p className="workspace-dialog-description">{isRtl ? "فضای موردنظر را انتخاب یا مدیریت کنید." : "Choose a place, or make it your own."}</p>
            <div className="property-manager-list">
              {properties.map((property) => (
                <div className={`property-manager-row${selectedId === property.id ? " is-current" : ""}`} key={property.id}>
                  <button type="button" className="property-manager-select" onClick={() => onSelect(property.id)}>
                    <span className="property-manager-photo" style={{ backgroundImage: `url("${photoUrl(property.coverPhoto)}")` }} />
                    <span className="property-manager-copy"><strong>{nameOf(property.name)}</strong><small>{nameOf(property.address) || propertyTypeLabel(property.type, locale)} · {roleLabel(property.role, locale)}</small></span>
                    {selectedId === property.id ? <span className="property-current-check"><Check size={14} /></span> : <ChevronRight size={16} />}
                  </button>
                  {can(property.role, "property.edit") && <button type="button" className="entity-edit-button" onClick={() => setEditing(property)} aria-label={isRtl ? `ویرایش ${nameOf(property.name)}` : `Edit ${property.name}`}><Pencil size={15} /></button>}
                  {can(property.role, "property.delete") && <button type="button" className="entity-delete-button" onClick={() => setDeleting(property)} aria-label={isRtl ? `حذف ${nameOf(property.name)}` : `Remove ${property.name}`}><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
            <button type="button" className="workspace-add-button" onClick={() => setCreating(true)}><Plus size={16} />{isRtl ? "افزودن خانه یا ملک" : "Add a home or property"}</button>
            <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "تمام" : "Done"}</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function PropertyFormView({ initial, locale, error, busy, onBack, onSave }: { initial: PropertyForm; locale: Locale; error: string; busy: boolean; onBack?: () => void; onSave: (form: PropertyForm) => void }) {
  const isRtl = locale === "fa";
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [type, setType] = useState<PropertyType>(initial.type);
  const [coverPhoto, setCoverPhoto] = useState<PhotoPreset>(initial.coverPhoto);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), address: address.trim(), type, coverPhoto });
  };

  return (
    <form className="workspace-form" onSubmit={submit}>
      <PhotoPresetPicker value={coverPhoto} locale={locale} onChange={setCoverPhoto} />
      <label className="form-field"><span>{isRtl ? "نام خانه / ملک" : "Name"}</span><input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder={isRtl ? "مثلاً ویلای شمال" : "e.g. The garden house"} /></label>
      <div className="form-two-columns">
        <label className="form-field"><span>{isRtl ? "نوع ملک" : "Property type"}</span><select value={type} onChange={(event) => setType(event.target.value as PropertyType)}>{propertyTypes.map((item) => <option key={item.value} value={item.value}>{isRtl ? item.fa : item.en}</option>)}</select></label>
        <label className="form-field"><span>{isRtl ? "نشانی" : "Address"}</span><input maxLength={200} value={address} onChange={(event) => setAddress(event.target.value)} placeholder={isRtl ? "شهر، محله" : "City, neighborhood"} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="workspace-form-actions">
        {onBack && <button type="button" className="button-subtle" onClick={onBack}>{isRtl ? "بازگشت" : "Back"}</button>}
        <button type="submit" className="button-primary" disabled={busy}><Check size={15} />{isRtl ? "ذخیره‌ی خانه" : "Save home"}</button>
      </div>
    </form>
  );
}

export function RoomEditorDialog({ room, locale, nameOf, canDelete, onClose, onSave, onDelete }: { room: Room | null; locale: Locale; nameOf: (name: string) => string; canDelete: boolean; onClose: () => void; onSave: (form: { name: string; photo: PhotoPreset }) => Promise<void>; onDelete: () => Promise<void> }) {
  const isRtl = locale === "fa";
  const [name, setName] = useState(room ? nameOf(room.name) : "");
  const [photo, setPhoto] = useState<PhotoPreset>(room?.photo ?? "living");
  const saving = useSaving(locale);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    void saving.run(() => onSave({ name: name.trim(), photo }));
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        <span className="workspace-dialog-icon"><Building2 size={19} /></span><span className="panel-overline">{isRtl ? "فضاهای خانه" : "HOME SPACES"}</span>
        <h2 id="room-dialog-title">{isRtl ? (room ? "ویرایش فضا" : "افزودن فضای جدید") : room ? "Edit space" : "Add a space"}</h2>
        <p className="workspace-dialog-description">{isRtl ? "برای فضا یک نام و عکس انتخاب کنید." : "Give this space a name and a photo."}</p>
        <form className="workspace-form" onSubmit={submit}>
          <PhotoPresetPicker value={photo} locale={locale} onChange={setPhoto} />
          <label className="form-field"><span>{isRtl ? "نام فضا" : "Space name"}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={isRtl ? "مثلاً آشپزخانه" : "e.g. Kitchen"} /></label>
          {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
          <div className="workspace-form-actions">
            {room && canDelete && <button type="button" className="button-danger-subtle" disabled={saving.busy} onClick={() => void saving.run(onDelete)}><Trash2 size={14} />{isRtl ? "حذف فضا" : "Delete space"}</button>}
            <button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "انصراف" : "Cancel"}</button>
            <button type="submit" className="button-primary" disabled={saving.busy}><Check size={15} />{isRtl ? "ذخیره‌ی فضا" : "Save space"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/** Rename a device or move it to another space. Its hardware (board, pins, type) never changes here. */
export function DeviceDetailsDialog({ device, name: currentName, rooms, locale, nameOf, onClose, onSave }: { device: Device; name: string; rooms: Room[]; locale: Locale; nameOf: (name: string) => string; onClose: () => void; onSave: (form: { name: string; roomId: string | null }) => Promise<void> }) {
  const isRtl = locale === "fa";
  const [name, setName] = useState(currentName);
  const [roomId, setRoomId] = useState(device.roomId ?? "");
  const saving = useSaving(locale);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    void saving.run(() => onSave({ name: name.trim(), roomId: roomId || null }));
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="device-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        <span className="workspace-dialog-icon"><Pencil size={18} /></span><span className="panel-overline">{text(deviceTypeInfo[device.type], locale)}</span>
        <h2 id="device-dialog-title">{isRtl ? "نام و فضای دستگاه" : "Name and space"}</h2>
        <form className="workspace-form" onSubmit={submit}>
          <label className="form-field"><span>{isRtl ? "نام دستگاه" : "Device name"}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="form-field"><span>{isRtl ? "فضا" : "Space"}</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">{isRtl ? "بدون فضا" : "No space"}</option>{rooms.map((room) => <option key={room.id} value={room.id}>{nameOf(room.name)}</option>)}</select></label>
          {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
          <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "انصراف" : "Cancel"}</button><button type="submit" className="button-primary" disabled={saving.busy}><Check size={15} />{isRtl ? "ذخیره" : "Save"}</button></div>
        </form>
      </section>
    </div>
  );
}

/**
 * Adding a device. Real devices come from M2smart boards added to the home through its hub by
 * scanning the board's QR code (Phase 4), never from a form, so real users see how that works.
 * The demo can add sample devices of any catalog type.
 */
export function AddDeviceDialog({ rooms, locale, nameOf, onClose, onAddDemo }: { rooms: Room[]; locale: Locale; nameOf: (name: string) => string; onClose: () => void; onAddDemo?: (input: { type: DeviceType; name: string; roomId: string | null }) => Promise<void> }) {
  const isRtl = locale === "fa";
  const [type, setType] = useState<DeviceType>("switch");
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const saving = useSaving(locale);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onAddDemo) return;
    void saving.run(() => onAddDemo({ type, name: name.trim() || text(deviceTypeInfo[type], locale), roomId: roomId || null }));
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="add-device-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        <span className="workspace-dialog-icon">{onAddDemo ? <Plus size={19} /> : <QrCode size={19} />}</span><span className="panel-overline">{isRtl ? "دستگاه‌های خانه" : "HOME DEVICES"}</span>
        <h2 id="add-device-title">{isRtl ? "افزودن دستگاه" : "Add a device"}</h2>
        {onAddDemo ? (
          <form className="workspace-form" onSubmit={submit}>
            <p className="workspace-dialog-description">{isRtl ? "در دمو می‌توانید هر نوع دستگاه M2smart را امتحان کنید." : "In the demo you can try any kind of M2smart device."}</p>
            <label className="form-field"><span>{isRtl ? "نوع دستگاه" : "Device type"}</span><select value={type} onChange={(event) => setType(event.target.value as DeviceType)}>{deviceTypeNames.map((item) => <option key={item} value={item}>{text(deviceTypeInfo[item], locale)}</option>)}</select></label>
            <label className="form-field"><span>{isRtl ? "نام دستگاه" : "Device name"}</span><input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={text(deviceTypeInfo[type], locale)} /></label>
            <label className="form-field"><span>{isRtl ? "فضا" : "Space"}</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">{isRtl ? "بدون فضا" : "No space"}</option>{rooms.map((room) => <option key={room.id} value={room.id}>{nameOf(room.name)}</option>)}</select></label>
            {saving.error && <p className="form-error" role="alert">{saving.error}</p>}
            <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "انصراف" : "Cancel"}</button><button type="submit" className="button-primary" disabled={saving.busy}><Plus size={15} />{isRtl ? "افزودن دستگاه" : "Add device"}</button></div>
          </form>
        ) : (
          <>
            <p className="workspace-dialog-description">{isRtl ? "دستگاه‌های M2smart روی بردهای مخصوص هر خانه ساخته می‌شوند و هر برد فقط از راه هاب خانه اضافه می‌شود؛ هیچ دستگاهی دستی ساخته نمی‌شود." : "M2smart devices live on boards made for your home, and a board is only added through your home's hub; devices are never created by hand."}</p>
            <ol className="pairing-steps">
              <li><Cpu size={15} />{isRtl ? "هاب M2smart را در خانه روشن و به اینترنت وصل کنید." : "Turn on your M2smart hub at home and connect it."}</li>
              <li><QrCode size={15} />{isRtl ? "کد QR روی برد را اسکن کنید تا دستگاه‌هایش به خانه اضافه شوند." : "Scan the QR code on the board; its devices join your home."}</li>
            </ol>
            <p className="form-note">{isRtl ? "اتصال هاب و اسکن QR در نسخه‌ی بعدی فعال می‌شود." : "Hub pairing and QR scanning arrive in the next release."}</p>
            <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "متوجه شدم" : "Got it"}</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function PhotoPresetPicker({ value, locale, onChange }: { value: PhotoPreset; locale: Locale; onChange: (preset: PhotoPreset) => void }) {
  return (
    <div className="photo-preset-grid" role="radiogroup" aria-label={locale === "fa" ? "عکس" : "Photo"}>
      {photoOptions.map((option) => (
        <button key={option.preset} type="button" role="radio" aria-checked={value === option.preset} className={`photo-preset${value === option.preset ? " selected" : ""}`} style={{ backgroundImage: `url("${photoUrl(option.preset)}")` }} onClick={() => onChange(option.preset)}>
          <span>{text(option, locale)}</span>
          {value === option.preset && <Check size={13} />}
        </button>
      ))}
    </div>
  );
}

function propertyTypeLabel(type: PropertyType, locale: Locale): string {
  const item = propertyTypes.find((option) => option.value === type);
  return item ? (locale === "fa" ? item.fa : item.en) : type;
}

function roleLabel(role: Property["role"], locale: Locale): string {
  const labels = { owner: { en: "Owner", fa: "مالک" }, admin: { en: "Admin", fa: "مدیر" }, member: { en: "Member", fa: "عضو" } } as const;
  return labels[role][locale];
}
