// Body of the Kratos → M2smart API identity webhooks. Only non-secret identity traits.
function(ctx) {
  identity_id: ctx.identity.id,
  phone: ctx.identity.traits.phone,
  email: if std.objectHas(ctx.identity.traits, 'email') then ctx.identity.traits.email else null,
  name: if std.objectHas(ctx.identity.traits, 'name') then ctx.identity.traits.name else null,
}
