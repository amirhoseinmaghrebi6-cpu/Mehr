"use client";

/**
 * People of a home: who belongs to it and in which role, inviting by mobile number, changing roles,
 * removing someone or leaving. And the banner with invitations to the signed-in user.
 *
 * Who may do what follows packages/contracts/src/permissions.ts (canManageRole); the API checks
 * the same rules again.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, LogOut, Mail, Trash2, UserPlus, Users, X } from "lucide-react";
import { can, canManageRole, invitableRoles, normalizePhone, type HomeMember, type InvitableRole, type MemberListResponse, type MyInvitation, type Property } from "@m2smart/contracts";
import { useI18n } from "@/components/i18n-provider";
import { gatewayMessage } from "@/lib/gateway-messages";
import { formatNumber, type Locale } from "@/lib/i18n";
import { GatewayError, type GatewayErrorCode, type HomeGateway } from "@/services/home-gateway";

const codeOf = (error: unknown): GatewayErrorCode => (error instanceof GatewayError ? error.code : "network");

/** "+989121112233" → "0912 111 2233" in the user's digits; other countries stay international. */
export function phoneLabel(e164: string, locale: Locale): string {
  const local = e164.startsWith("+98") ? `0${e164.slice(3, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}` : e164;
  return local.replace(/\d/g, (digit) => formatNumber(Number(digit), locale));
}

type SectionProps = {
  gateway: HomeGateway;
  property: Property;
  nameOf: (name: string) => string;
  onToast: (message: string, tone?: "ok" | "warn") => void;
  /** After the user left the home. */
  onLeft: () => void;
};

export function MembersSection({ gateway, property, nameOf, onToast, onLeft }: SectionProps) {
  const { locale, m } = useI18n();
  const t = m.members;
  const roles = m.dialogs.roles;
  const [list, setList] = useState<MemberListResponse | null>(null);
  const [loadError, setLoadError] = useState<GatewayErrorCode | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const manager = can(property.role, "member.manage");

  const load = useCallback(async () => {
    try {
      setList(await gateway.listMembers(property.id));
      setLoadError(null);
    } catch (error) {
      setLoadError(codeOf(error));
    }
  }, [gateway, property.id]);
  useEffect(() => void load(), [load]);

  /** Runs a change and reloads the list; true if it worked. */
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      onToast(done);
      return true;
    } catch (error) {
      onToast(gatewayMessage(codeOf(error), locale), "warn");
      return false;
    } finally {
      setConfirming(null);
      void load();
    }
  };

  if (loadError && !list) return <div className="quiet-panel" role="alert"><span className="quiet-icon"><Users size={24} /></span><h2>{gatewayMessage(loadError, locale)}</h2><button type="button" className="workspace-quick-add" onClick={() => void load()}>{m.common.tryAgain}</button></div>;
  if (!list) return null;

  const memberRow = (member: HomeMember) => {
    const name = member.you ? t.you : nameOf(member.name) || t.noName;
    const manageable = !member.you && canManageRole(property.role, member.role);
    const removeKey = `remove-${member.userId}`;
    return (
      <li className="member-row" key={member.userId}>
        <span className="profile-avatar member-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <span className="member-copy">
          <strong>{name}</strong>
          <small>{member.phone ? <bdi dir="ltr">{phoneLabel(member.phone, locale)}</bdi> : null}</small>
        </span>
        {manageable && property.role === "owner" ? (
          <select className="member-role" aria-label={t.roleOf(name)} value={member.role} onChange={(event) => void act(() => gateway.updateMember(property.id, member.userId, { role: event.target.value as InvitableRole }), t.toasts.roleChanged(name))}>
            {invitableRoles.map((role) => <option key={role} value={role}>{roles[role]}</option>)}
          </select>
        ) : (
          <span className={`member-role-badge role-${member.role}`}>{roles[member.role]}</span>
        )}
        {manageable && (confirming === removeKey ? (
          <span className="member-confirm">
            <button type="button" className="button-danger" onClick={() => void act(() => gateway.removeMember(property.id, member.userId), t.toasts.removed(name))}><Trash2 size={14} />{t.confirmRemove}</button>
            <button type="button" className="button-subtle" onClick={() => setConfirming(null)}>{m.common.cancel}</button>
          </span>
        ) : (
          <button type="button" className="icon-button member-remove" aria-label={t.remove(name)} title={t.remove(name)} onClick={() => setConfirming(removeKey)}><Trash2 size={15} /></button>
        ))}
      </li>
    );
  };

  const you = list.members.find((member) => member.you);
  return (
    <section className="members-layout">
      <div className="surface-panel members-panel">
        <div className="panel-intro"><span className="panel-overline">{m.nav.members}</span><h2>{t.title(nameOf(property.name))}</h2><p>{manager ? t.subtitle : t.memberSubtitle(roles[property.role])}</p></div>
        <ul className="member-list">{list.members.map(memberRow)}</ul>

        {manager && list.invitations.length > 0 && (
          <>
            <span className="panel-overline members-overline">{t.pending}</span>
            <ul className="member-list">
              {list.invitations.map((invitation) => (
                <li className="member-row is-pending" key={invitation.id}>
                  <span className="profile-avatar member-avatar" aria-hidden="true"><Mail size={14} /></span>
                  <span className="member-copy"><strong><bdi dir="ltr">{phoneLabel(invitation.phone, locale)}</bdi></strong><small>{t.invitedAs(roles[invitation.role])}</small></span>
                  {canManageRole(property.role, invitation.role) && <button type="button" className="icon-button member-remove" aria-label={t.cancelInvitation} title={t.cancelInvitation} onClick={() => void act(() => gateway.cancelInvitation(property.id, invitation.id), t.toasts.cancelled)}><X size={15} /></button>}
                </li>
              ))}
            </ul>
          </>
        )}

        {manager && <InviteForm property={property} onInvite={async (phone, role) => { await gateway.invite(property.id, { phone, role }); onToast(t.toasts.invited(phoneLabel(normalizePhone(phone) ?? phone, locale))); void load(); }} />}

        {you && you.role !== "owner" && (confirming === "leave" ? (
          <div className="member-leave">
            <p>{t.leaveQuestion(nameOf(property.name))}</p>
            <span className="member-confirm">
              <button type="button" className="button-danger" onClick={() => void act(() => gateway.removeMember(property.id, you.userId), t.toasts.left(nameOf(property.name))).then((left) => left && onLeft())}><LogOut size={14} />{t.confirmLeave}</button>
              <button type="button" className="button-subtle" onClick={() => setConfirming(null)}>{m.common.cancel}</button>
            </span>
          </div>
        ) : (
          <div className="member-leave"><button type="button" className="button-danger-subtle" onClick={() => setConfirming("leave")}><LogOut size={14} />{t.leave}</button></div>
        ))}
      </div>
    </section>
  );
}

function InviteForm({ property, onInvite }: { property: Property; onInvite: (phone: string, role: InvitableRole) => Promise<void> }) {
  const { locale, m } = useI18n();
  const t = m.members;
  const offered = invitableRoles.filter((role) => canManageRole(property.role, role));
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!normalizePhone(phone)) return setError(t.invalidPhone);
    setBusy(true);
    setError("");
    try {
      await onInvite(phone, role);
      setPhone("");
    } catch (caught) {
      const code = codeOf(caught);
      setError(code === "conflict" ? t.alreadyThere : code === "invalid_request" ? t.invalidPhone : gatewayMessage(code, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="invite-form" onSubmit={(event) => void submit(event)}>
      <span className="panel-overline members-overline">{t.inviteTitle}</span>
      <div className="invite-fields">
        <label className="form-field"><span>{t.phone}</span><input type="tel" inputMode="tel" dir="ltr" autoComplete="off" required maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t.phonePlaceholder} /></label>
        <label className="form-field"><span>{t.role}</span><select value={role} onChange={(event) => setRole(event.target.value as InvitableRole)}>{offered.map((item) => <option key={item} value={item}>{m.dialogs.roles[item]}</option>)}</select></label>
        <button type="submit" className="button-primary" disabled={busy}><UserPlus size={15} />{t.invite}</button>
      </div>
      <p className="form-note">{t.roleHints[role]}</p>
      <p className="form-note">{t.inviteNote}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}

/** Invitations to the signed-in user, shown above every section until accepted or declined. */
export function InvitationBanner({ gateway, nameOf, onAccepted, onCount }: { gateway: HomeGateway; nameOf: (name: string) => string; onAccepted: (property: Property) => void; /** How many are waiting, once known (0 if they could not be loaded). */ onCount?: (count: number) => void }) {
  const { locale, m } = useI18n();
  const t = m.members;
  const [invitations, setInvitations] = useState<MyInvitation[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    gateway.listMyInvitations().then(
      (list) => active && setInvitations(list),
      () => active && setInvitations([]),
    );
    return () => {
      active = false;
    };
  }, [gateway]);

  useEffect(() => {
    if (invitations) onCount?.(invitations.length);
  }, [invitations, onCount]);

  const answer = async (invitation: MyInvitation, accept: boolean) => {
    setBusy(invitation.id);
    setError("");
    try {
      if (accept) onAccepted(await gateway.acceptInvitation(invitation.id));
      else await gateway.declineInvitation(invitation.id);
      setInvitations((current) => (current ?? []).filter((item) => item.id !== invitation.id));
    } catch (caught) {
      setError(gatewayMessage(codeOf(caught), locale));
    } finally {
      setBusy(null);
    }
  };

  if (!invitations?.length) return null;
  return (
    <div className="invitation-banners">
      {invitations.map((invitation) => (
        <section className="invitation-banner" key={invitation.id} aria-label={t.invitedTo(nameOf(invitation.propertyName))}>
          <span className="invitation-icon"><Mail size={18} /></span>
          <span className="invitation-copy">
            <strong>{t.invitedTo(nameOf(invitation.propertyName))}</strong>
            <small>{t.invitedBy(nameOf(invitation.invitedBy) || t.someone, m.dialogs.roles[invitation.role])}</small>
          </span>
          <span className="invitation-actions">
            <button type="button" className="button-subtle" disabled={busy === invitation.id} onClick={() => void answer(invitation, false)}>{t.decline}</button>
            <button type="button" className="button-primary" disabled={busy === invitation.id} onClick={() => void answer(invitation, true)}><Check size={14} />{t.accept}</button>
          </span>
        </section>
      ))}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
