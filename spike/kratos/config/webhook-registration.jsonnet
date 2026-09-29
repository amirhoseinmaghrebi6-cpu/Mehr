// Body of the after-registration webhook to the M2smart API (identity sync, Phase 2D-4).
function(ctx) {
  identity_id: ctx.identity.id,
  phone: ctx.identity.traits.phone,
  name: if std.objectHas(ctx.identity.traits, 'name') then ctx.identity.traits.name else null,
}
