"use client";

import { useState, type FormEvent } from "react";
import { Building2, Check, ChevronRight, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { Device, DeviceKind, Property, PropertyType, Room } from "@/services/mock-home-service";

const propertyTypes: { value: PropertyType; en: string; fa: string }[] = [
  { value: "house", en: "House", fa: "خانه" },
  { value: "villa", en: "Villa", fa: "ویلا" },
  { value: "apartment", en: "Apartment", fa: "آپارتمان" },
  { value: "office", en: "Office", fa: "دفتر کار" },
  { value: "commercial", en: "Shop / commercial", fa: "مغازه / تجاری" },
  { value: "custom", en: "Other", fa: "سایر" },
];

const deviceKinds: { value: DeviceKind; en: string; fa: string }[] = [
  { value: "light", en: "Light", fa: "چراغ" },
  { value: "climate", en: "Climate control", fa: "تهویه" },
  { value: "curtain", en: "Curtain / blind", fa: "پرده / کرکره" },
  { value: "plug", en: "Smart plug / switch", fa: "پریز / کلید هوشمند" },
  { value: "lock", en: "Door lock", fa: "قفل در" },
  { value: "air", en: "Air quality sensor", fa: "حسگر کیفیت هوا" },
];

type PropertyForm = Pick<Property, "name" | "address" | "type" | "coverImage">;

export function PropertyManagerDialog({
  properties,
  selectedId,
  locale,
  onClose,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
}: {
  properties: Property[];
  selectedId: string;
  locale: Locale;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: (property: Property) => void;
  onUpdate: (property: Property) => void;
  onDelete: (id: string) => void;
}) {
  const isRtl = locale === "fa";
  const [editing, setEditing] = useState<Property | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Property | null>(null);
  const [error, setError] = useState("");

  const startCreate = () => {
    setCreating(true);
    setEditing(null);
    setError("");
  };

  const startEdit = (property: Property) => {
    setEditing(property);
    setCreating(false);
    setError("");
  };

  const saveProperty = (form: PropertyForm) => {
    if (creating) {
      onCreate({ ...form, id: `home-${crypto.randomUUID()}`, online: false });
      setCreating(false);
    } else if (editing) {
      onUpdate({ ...editing, ...form });
      setEditing(null);
    }
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog property-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="property-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        {creating || editing ? (
          <>
            <span className="workspace-dialog-icon"><Building2 size={19} /></span>
            <span className="panel-overline">{isRtl ? "مدیریت ملک‌ها" : "PROPERTY DETAILS"}</span>
            <h2 id="property-dialog-title">{isRtl ? (creating ? "خانه‌ی جدید" : "ویرایش ملک") : (creating ? "Add a home" : "Edit property")}</h2>
            <p className="workspace-dialog-description">{isRtl ? "نام، نوع، نشانی و تصویر خانه را تنظیم کنید." : "Set a name, type, address and cover photo for this place."}</p>
            <PropertyFormView
              key={editing?.id ?? "new-property"}
              initial={editing ?? { name: "", address: "", type: "house", coverImage: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1200&q=82" }}
              locale={locale}
              error={error}
              onBack={() => { setCreating(false); setEditing(null); setError(""); }}
              onError={setError}
              onSave={saveProperty}
            />
          </>
        ) : deleting ? (
          <>
            <span className="workspace-dialog-icon delete-dialog-icon"><Trash2 size={19} /></span>
            <span className="panel-overline">{isRtl ? "تأیید حذف" : "REMOVE PROPERTY"}</span>
            <h2 id="property-dialog-title">{isRtl ? `«${deleting.name}» حذف شود؟` : `Remove ${deleting.name}?`}</h2>
            <p className="workspace-dialog-description">{isRtl ? "فضاها و دستگاه‌های این خانه نیز از این مرورگر حذف می‌شوند. این کار قابل بازگشت نیست." : "Its rooms and devices will also be removed from this browser. This can’t be undone."}</p>
            <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={() => setDeleting(null)}>{isRtl ? "انصراف" : "Keep property"}</button><button type="button" className="button-danger" onClick={() => { onDelete(deleting.id); setDeleting(null); }}>{isRtl ? "حذف خانه" : "Remove home"}</button></div>
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
                    <span className="property-manager-photo" style={{ backgroundImage: `url("${property.coverImage}")` }} />
                    <span className="property-manager-copy"><strong>{property.name}</strong><small>{property.address || propertyTypeLabel(property.type, locale)}</small></span>
                    {selectedId === property.id ? <span className="property-current-check"><Check size={14} /></span> : <ChevronRight size={16} />}
                  </button>
                  <button type="button" className="entity-edit-button" onClick={() => startEdit(property)} aria-label={isRtl ? `ویرایش ${property.name}` : `Edit ${property.name}`}><Pencil size={15} /></button>
                  {properties.length > 1 && <button type="button" className="entity-delete-button" onClick={() => setDeleting(property)} aria-label={isRtl ? `حذف ${property.name}` : `Remove ${property.name}`}><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
            <button type="button" className="workspace-add-button" onClick={startCreate}><Plus size={16} />{isRtl ? "افزودن خانه یا ملک" : "Add a home or property"}</button>
            <div className="workspace-form-actions single-action"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "تمام" : "Done"}</button></div>
          </>
        )}
      </section>
    </div>
  );
}

function PropertyFormView({ initial, locale, error, onBack, onError, onSave }: { initial: PropertyForm; locale: Locale; error: string; onBack: () => void; onError: (message: string) => void; onSave: (form: PropertyForm) => void }) {
  const isRtl = locale === "fa";
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [type, setType] = useState<PropertyType>(initial.type);
  const [coverImage, setCoverImage] = useState(initial.coverImage);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), address: address.trim(), type, coverImage });
  };

  return (
    <form className="workspace-form" onSubmit={submit}>
      <ImagePicker image={coverImage} locale={locale} onChange={setCoverImage} onError={onError} />
      <label className="form-field"><span>{isRtl ? "نام خانه / ملک" : "Name"}</span><input autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder={isRtl ? "مثلاً ویلای شمال" : "e.g. The garden house"} /></label>
      <div className="form-two-columns"><label className="form-field"><span>{isRtl ? "نوع ملک" : "Property type"}</span><select value={type} onChange={(event) => setType(event.target.value as PropertyType)}>{propertyTypes.map((item) => <option key={item.value} value={item.value}>{isRtl ? item.fa : item.en}</option>)}</select></label><label className="form-field"><span>{isRtl ? "نشانی" : "Address"}</span><input maxLength={90} value={address} onChange={(event) => setAddress(event.target.value)} placeholder={isRtl ? "شهر، محله" : "City, neighborhood"} /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={onBack}>{isRtl ? "بازگشت" : "Back"}</button><button type="submit" className="button-primary"><Check size={15} />{isRtl ? "ذخیره‌ی خانه" : "Save home"}</button></div>
    </form>
  );
}

export function RoomEditorDialog({ room, locale, onClose, onSave }: { room: Room | null; locale: Locale; onClose: () => void; onSave: (room: Room) => void }) {
  const isRtl = locale === "fa";
  const [name, setName] = useState(room?.name ?? "");
  const [image, setImage] = useState(room?.image ?? "https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?auto=format&fit=crop&w=1200&q=82");
  const [error, setError] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({
      id: room?.id ?? `room-${crypto.randomUUID()}`,
      name: name.trim(),
      temperature: room?.temperature ?? 22,
      humidity: room?.humidity ?? 45,
      activeDevices: room?.activeDevices ?? 0,
      image,
      imagePosition: room?.imagePosition ?? "center",
    });
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        <span className="workspace-dialog-icon"><Building2 size={19} /></span><span className="panel-overline">{isRtl ? "فضاهای خانه" : "HOME SPACES"}</span>
        <h2 id="room-dialog-title">{isRtl ? (room ? "ویرایش فضا" : "افزودن فضای جدید") : (room ? "Edit space" : "Add a space")}</h2>
        <p className="workspace-dialog-description">{isRtl ? "برای فضا یک نام و عکس انتخاب کنید." : "Give this space a name and a photo."}</p>
        <form className="workspace-form" onSubmit={submit}>
          <ImagePicker image={image} locale={locale} onChange={setImage} onError={setError} />
          <label className="form-field"><span>{isRtl ? "نام فضا" : "Space name"}</span><input autoFocus required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder={isRtl ? "مثلاً آشپزخانه" : "e.g. Kitchen"} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "انصراف" : "Cancel"}</button><button type="submit" className="button-primary"><Check size={15} />{isRtl ? "ذخیره‌ی فضا" : "Save space"}</button></div>
        </form>
      </section>
    </div>
  );
}

export function DeviceEditorDialog({ rooms, locale, onClose, onSave }: { rooms: Room[]; locale: Locale; onClose: () => void; onSave: (device: Device) => void }) {
  const isRtl = locale === "fa";
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DeviceKind>("light");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const room = rooms.find((item) => item.id === roomId);
    if (!name.trim() || !room) return;
    const defaults: Partial<Record<DeviceKind, number>> = { climate: 22, light: 50, curtain: 0 };
    onSave({
      id: `device-${crypto.randomUUID()}`,
      name: name.trim(),
      kind,
      roomId: room.id,
      room: room.name,
      detail: kind === "climate" ? "22°C · Auto" : kind === "light" ? "Warm white · 50%" : kind === "curtain" ? "Closed · 0%" : isRtl ? "آماده به کار" : "Ready when you are",
      value: defaults[kind],
      online: true,
      initialState: false,
    });
  };

  return (
    <div className="modal-backdrop workspace-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="device-dialog-title" dir={isRtl ? "rtl" : "ltr"}>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={isRtl ? "بستن" : "Close"}><X size={18} /></button>
        <span className="workspace-dialog-icon"><Plus size={19} /></span><span className="panel-overline">{isRtl ? "دستگاه‌های خانه" : "HOME DEVICES"}</span>
        <h2 id="device-dialog-title">{isRtl ? "افزودن دستگاه" : "Add a device"}</h2>
        <p className="workspace-dialog-description">{isRtl ? "دستگاه را نام‌گذاری و به یکی از فضاها اضافه کنید." : "Name the device and choose where it belongs."}</p>
        {rooms.length === 0 ? <p className="form-error">{isRtl ? "ابتدا یک فضا بسازید." : "Create a space before adding a device."}</p> : (
          <form className="workspace-form" onSubmit={submit}>
            <label className="form-field"><span>{isRtl ? "نام دستگاه" : "Device name"}</span><input autoFocus required maxLength={50} value={name} onChange={(event) => setName(event.target.value)} placeholder={isRtl ? "مثلاً چراغ سقفی" : "e.g. Ceiling light"} /></label>
            <label className="form-field"><span>{isRtl ? "نوع دستگاه" : "Device type"}</span><select value={kind} onChange={(event) => setKind(event.target.value as DeviceKind)}>{deviceKinds.map((item) => <option key={item.value} value={item.value}>{isRtl ? item.fa : item.en}</option>)}</select></label>
            <label className="form-field"><span>{isRtl ? "افزودن به فضا" : "Add to space"}</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
            <div className="workspace-form-actions"><button type="button" className="button-subtle" onClick={onClose}>{isRtl ? "انصراف" : "Cancel"}</button><button type="submit" className="button-primary"><Plus size={15} />{isRtl ? "افزودن دستگاه" : "Add device"}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}

function ImagePicker({ image, locale, onChange, onError }: { image: string; locale: Locale; onChange: (image: string) => void; onError: (message: string) => void }) {
  const isRtl = locale === "fa";

  const readImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      onError(isRtl ? "لطفاً یک فایل تصویری انتخاب کنید." : "Choose an image file.");
      return;
    }

    try {
      const source = URL.createObjectURL(file);
      const img = new Image();
      img.src = source;
      await img.decode();
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source);
      onChange(canvas.toDataURL("image/jpeg", 0.78));
      onError("");
    } catch {
      onError(isRtl ? "بارگذاری عکس انجام نشد؛ تصویر دیگری انتخاب کنید." : "That photo couldn’t be loaded. Try another image.");
    }
  };

  return (
    <div className="image-picker-preview" style={{ backgroundImage: `linear-gradient(0deg, rgb(12 18 13 / 25%), transparent 55%), url("${image}")` }}>
      <label className="image-picker-button"><ImagePlus size={15} /><span>{isRtl ? "تغییر عکس" : "Change photo"}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImage(file); event.currentTarget.value = ""; }} /></span></label>
    </div>
  );
}

function propertyTypeLabel(type: PropertyType, locale: Locale): string {
  const item = propertyTypes.find((option) => option.value === type);
  return item ? (locale === "fa" ? item.fa : item.en) : type;
}
