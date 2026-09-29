// Body Kratos POSTs to the SMS provider. A real Iranian provider gets its own field names here.
function(ctx) {
  to: ctx.recipient,
  text: ctx.body,
  template: ctx.template_type,
}
