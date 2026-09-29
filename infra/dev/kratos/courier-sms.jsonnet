// Request body Kratos sends to the SMS endpoint. In development that is the API's
// POST /internal/dev/sms, which only logs the message. A real Iranian SMS provider gets its own
// field names here (Phase 2D-4 / production config).
function(ctx) {
  to: ctx.recipient,
  text: ctx.body,
  template: ctx.template_type,
}
